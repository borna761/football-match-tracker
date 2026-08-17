// API_KEY is loaded from config.js

const LOOKAHEAD_DAYS = 60;

// The football-data.org API has no top-level "type" field on team objects.
// National teams are identified by their runningCompetitions codes instead.
const NATIONAL_COMP_CODES = new Set(["WC", "EC"]);

// Free-tier competitions (mirrors the COMPETITIONS list in settings.js). Used as
// a fallback sweep when a tracked team has no known competition yet — e.g. a club
// whose /v4/teams/{id} record is 403'd because it's in a restricted competition.
const FREE_COMP_CODES = ["PL", "PD", "BL1", "SA", "FL1", "CL", "WC", "EC", "ELC", "DED", "PPL"];

// A team with no fixtures in the window never gets a competition recorded, so it
// would otherwise re-trigger the full free-tier sweep on every refresh forever.
// Throttle the sweep to at most once per this interval.
const SWEEP_THROTTLE_MS = 12 * 60 * 60 * 1000; // 12 hours

// Fetch a single competition's matches in the lookahead window.
// We fetch per competition rather than per team because the team-matches
// endpoint returns 403 if a team has any fixture in a competition outside the
// key's plan (it can't be filtered). Per-competition requests instead let us
// skip the restricted ones and keep what the key can access — which also means
// a paid key automatically gets the competitions a free key can't.
async function fetchCompMatches(code) {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + LOOKAHEAD_DAYS);
  // Use local date for dateFrom so matches from today aren't missed when
  // the local clock is still on "today" but UTC has already rolled over.
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${localIsoDate(from)}&dateTo=${isoDate(to)}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errorCode) throw new Error(json.message);
  const remaining = parseInt(res.headers.get("X-Requests-Available-Minute") ?? "10", 10);
  const resetSecs = parseInt(res.headers.get("X-RequestCounter-Reset") ?? "0", 10);
  return { matches: json.matches || [], remaining, resetSecs };
}

// Whether the throttle window has elapsed since the last recorded sweep. This is
// a read-only check — the caller stamps (markSwept) only AFTER a sweep that
// actually reached the API, so a fully-failed sweep (rate limit/outage) retries
// next refresh instead of being suppressed for the whole window.
function sweepAllowed() {
  return new Promise((resolve) => {
    chrome.storage.local.get("lastCompSweep", (data) => {
      resolve(!data.lastCompSweep || Date.now() - data.lastCompSweep >= SWEEP_THROTTLE_MS);
    });
  });
}

function markSwept() {
  chrome.storage.local.set({ lastCompSweep: Date.now() });
}

// Fetch upcoming matches for the given teams. Queries the union of competitions
// the teams play in (one request each), then keeps only matches involving a
// tracked team. Competitions the key can't access (free-tier 403) are skipped.
async function fetchAllMatches(teams) {
  const trackedIds = new Set(teams.map((t) => t.id));
  const codes = new Set(teams.flatMap((t) => t.competitions || []));
  // If any team has no known competition (e.g. a club whose team-info endpoint
  // is 403'd), sweep all free-tier competitions and filter by team id. Match
  // data carries the team's real competition, so the sweep self-corrects once
  // teamsFromMatches() records it. Throttled so a team that simply has no
  // fixtures (off-season) doesn't re-sweep all 11 competitions every refresh.
  const swept = teams.some((t) => !(t.competitions && t.competitions.length)) && await sweepAllowed();
  if (swept) {
    for (const c of FREE_COMP_CODES) codes.add(c);
  }

  const allMatches = [];
  const seen = new Set();
  let anyOk = false;

  for (const code of codes) {
    try {
      const { matches, remaining, resetSecs } = await fetchCompMatches(code);
      anyOk = true;
      for (const match of matches) {
        if (!trackedIds.has(match.homeTeam.id) && !trackedIds.has(match.awayTeam.id)) continue;
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        allMatches.push(match);
      }
      if (remaining <= 1 && resetSecs > 0) {
        await new Promise((r) => setTimeout(r, resetSecs * 1000 + 200));
      }
    } catch (err) {
      // Skip competitions outside the key's plan (403) or that error; the rest
      // still load. warn, not error — this is expected and handled.
      console.warn(`Skipping competition ${code}:`, err.message);
    }
  }

  // Record the sweep only if at least one request reached the API; a fully
  // failed sweep (rate limit/outage) should retry, not be suppressed 12h.
  if (swept && anyOk) markSwept();

  allMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  return allMatches;
}

// Derive up-to-date team records (name, shortName, crest, national flag, and the
// competitions they actually play in) from fetched match data. This is how we
// avoid the /v4/teams/{id} endpoint entirely — match objects carry each team's
// metadata, so a club whose team-info endpoint is 403'd still gets a real name
// and its competition recorded for the next, cheaper refresh. Teams with no
// matches in range keep their existing record. Pure — exported for testing.
function teamsFromMatches(teams, matches) {
  // Bucket matches by team id in one pass (O(matches)) rather than filtering the
  // full list per team (O(teams × matches)).
  const byTeam = new Map();
  for (const m of matches) {
    for (const side of [m.homeTeam, m.awayTeam]) {
      const list = byTeam.get(side.id);
      if (list) list.push(m); else byTeam.set(side.id, [m]);
    }
  }

  return teams.map((t) => {
    const mine = byTeam.get(t.id);
    if (!mine) return t;
    const sample = mine[0].homeTeam.id === t.id ? mine[0].homeTeam : mine[0].awayTeam;
    const discovered = mine.map((m) => m.competition.code).filter(Boolean);
    // Union with existing codes so a competition that simply has no fixtures in
    // the current window (e.g. CL before the group stage) isn't dropped.
    const competitions = [...new Set([...(t.competitions || []), ...discovered])];
    return {
      ...t,
      name:      sample.name      ?? t.name,
      shortName: sample.shortName ?? t.shortName,
      crest:     sample.crest     ?? t.crest,
      // National identity is sticky: keep an existing true (set when the team was
      // added from a WC/EC competition) and only ever add it from match data —
      // never flip a national team to club because its current fixtures happen
      // to be friendlies/qualifiers outside WC/EC.
      national:  t.national || competitions.some((c) => NATIONAL_COMP_CODES.has(c)),
      competitions,
    };
  });
}

async function fetchCompTeams(code) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.teams || []).map((t) => ({
    id:        t.id,
    name:      t.name,
    shortName: t.shortName,
    crest:     t.crest,
  }));
}

// Fetch just the team ids on a competition's roster — cheaper than
// fetchCompTeams for resolveTeamCompetitions, which only needs membership.
async function fetchCompTeamIds(code) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const remaining = parseInt(res.headers.get("X-Requests-Available-Minute") ?? "10", 10);
  const resetSecs = parseInt(res.headers.get("X-RequestCounter-Reset") ?? "0", 10);
  return { ids: new Set((json.teams || []).map((t) => t.id)), remaining, resetSecs };
}

// Given a target team id and a map of {competitionCode: Set<teamId>} rosters,
// return every code whose roster includes that team. Pure — exported for
// testing.
function matchingCompetitions(id, rostersByCode) {
  return Object.entries(rostersByCode)
    .filter(([, ids]) => ids.has(id))
    .map(([code]) => code);
}

// Query every free-tier competition's roster and return the codes where this
// team actually appears. This is the only authoritative source: unlike a
// team's runningCompetitions, a roster reflects real enrollment even before
// fixtures are scheduled (e.g. a team confirmed in this season's Champions
// League bracket, with no CL matches published yet); and unlike the single
// competition a team was browsed from in Settings, it doesn't depend on which
// list the user happened to click "Add" from. Resilient per-competition: a
// failed roster fetch is skipped (warn, not thrown) rather than losing every
// other competition's result.
async function resolveTeamCompetitions(id) {
  const rostersByCode = {};
  for (const code of FREE_COMP_CODES) {
    try {
      const { ids, remaining, resetSecs } = await fetchCompTeamIds(code);
      rostersByCode[code] = ids;
      if (remaining <= 1 && resetSecs > 0) {
        await new Promise((r) => setTimeout(r, resetSecs * 1000 + 200));
      }
    } catch (err) {
      console.warn(`Skipping roster ${code}:`, err.message);
    }
  }
  return matchingCompetitions(id, rostersByCode);
}

// Merge a freshly resolved competitions list into an already-tracked team's
// record. Unions rather than replaces — a competition already recorded is
// never dropped just because one roster fetch missed it (a transient failure,
// or a competition this sweep didn't reach yet). National is recomputed the
// same sticky way as teamsFromMatches. Pure — exported for testing.
function applyResolvedCompetitions(team, resolved) {
  const competitions = [...new Set([...(team.competitions || []), ...resolved])];
  return {
    ...team,
    competitions,
    national: team.national || competitions.some((c) => NATIONAL_COMP_CODES.has(c)),
  };
}

// Re-resolve every already-tracked team's competitions from roster
// membership. Run periodically (see background.js) so a competition
// confirmed after a team was added — e.g. a club's Champions League slot
// settling in once fd.org publishes the league-phase draw — gets picked up
// automatically, without the user needing to remove and re-add the team.
async function refreshTeamCompetitions(teams) {
  const updated = [];
  for (const team of teams) {
    const resolved = await resolveTeamCompetitions(team.id);
    updated.push(applyResolvedCompetitions(team, resolved));
  }
  return updated;
}

// Pure helpers exported for testing.
if (typeof module !== "undefined") {
  module.exports = { teamsFromMatches, matchingCompetitions, applyResolvedCompetitions };
}
