// API_KEY is loaded from config.js

const LOOKAHEAD_DAYS = 60;

// The football-data.org API has no top-level "type" field on team objects.
// National teams are identified by their runningCompetitions codes instead.
const NATIONAL_COMP_CODES = new Set(["WC", "EC"]);

async function fetchMatches(team) {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + LOOKAHEAD_DAYS);
  // Use local date for dateFrom so matches from today aren't missed when
  // the local clock is still on "today" but UTC has already rolled over.
  const url = `https://api.football-data.org/v4/teams/${team.id}/matches?dateFrom=${localIsoDate(from)}&dateTo=${isoDate(to)}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errorCode) throw new Error(json.message);
  const remaining = parseInt(res.headers.get("X-Requests-Available-Minute") ?? "10", 10);
  const resetSecs = parseInt(res.headers.get("X-RequestCounter-Reset") ?? "0", 10);
  return { matches: json.matches || [], remaining, resetSecs };
}

async function fetchAllMatches(teams) {
  const allMatches = [];
  const seen = new Set();

  for (const team of teams) {
    try {
      const { matches, remaining, resetSecs } = await fetchMatches(team);
      for (const match of matches) {
        if (!seen.has(match.id)) {
          seen.add(match.id);
          allMatches.push(match);
        }
      }
      if (remaining <= 1 && resetSecs > 0) {
        await new Promise((r) => setTimeout(r, resetSecs * 1000 + 200));
      }
    } catch (err) {
      console.error(`${team.name}:`, err.message);
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
  const national = (json.runningCompetitions || []).some((c) => NATIONAL_COMP_CODES.has(c.code));
  return { id, name: json.name, shortName: json.shortName, crest: json.crest, national };
}

async function fetchAllTeams(teamIds) {
  const results = [];
  for (const id of teamIds) {
    try {
      results.push(await fetchTeamInfo(id));
    } catch (err) {
      console.error(`Team ${id}:`, err.message);
      results.push({ id, name: String(id), shortName: String(id), crest: null, national: false });
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
