// API_KEY is loaded from config.js

const LOOKAHEAD_DAYS = 60;

// The football-data.org API has no top-level "type" field on team objects.
// National teams are identified by their runningCompetitions codes instead.
const NATIONAL_COMP_CODES = new Set(["WC", "EC"]);

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

// Fetch upcoming matches for the given teams. Queries the union of competitions
// the teams play in (one request each), then keeps only matches involving a
// tracked team. Competitions the key can't access (free-tier 403) are skipped.
async function fetchAllMatches(teams) {
  const trackedIds = new Set(teams.map((t) => t.id));
  const codes = [...new Set(teams.flatMap((t) => t.competitions || []))];

  const allMatches = [];
  const seen = new Set();

  for (const code of codes) {
    try {
      const { matches, remaining, resetSecs } = await fetchCompMatches(code);
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

  allMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  return allMatches;
}

async function fetchTeamInfo(id) {
  const res = await fetch(`https://api.football-data.org/v4/teams/${id}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const remaining = parseInt(res.headers.get("X-Requests-Available-Minute") ?? "10", 10);
  const resetSecs = parseInt(res.headers.get("X-RequestCounter-Reset") ?? "0", 10);
  if (remaining <= 1 && resetSecs > 0) {
    await new Promise((r) => setTimeout(r, resetSecs * 1000 + 200));
  }
  const running = json.runningCompetitions || [];
  const competitions = running.map((c) => c.code).filter(Boolean);
  const national = running.some((c) => NATIONAL_COMP_CODES.has(c.code));
  return { id, name: json.name, shortName: json.shortName, crest: json.crest, national, competitions };
}

async function fetchAllTeams(teamIds) {
  const results = [];
  for (const id of teamIds) {
    try {
      results.push(await fetchTeamInfo(id));
    } catch (err) {
      // Expected and handled: fall back to a placeholder so the team still
      // appears; warn (not error) since this is recoverable.
      console.warn(`Team ${id} info unavailable:`, err.message);
      results.push({ id, name: String(id), shortName: String(id), crest: null, national: false, competitions: [] });
    }
  }
  return results;
}

async function fetchCompTeams(code) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // Derive national status from the competition code rather than t.type,
  // because the API does not reliably set a top-level type field on team objects.
  const isNational = NATIONAL_COMP_CODES.has(code);
  return (json.teams || []).map((t) => ({
    id:        t.id,
    name:      t.name,
    shortName: t.shortName,
    crest:     t.crest,
    national:  isNational,
  }));
}
