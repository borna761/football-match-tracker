const { teamsFromMatches, matchingCompetitions, applyResolvedCompetitions, buildSweepQueue, recordSweepResult, anyCompetitionsChanged } = require("../api");

// ── helpers ──────────────────────────────────────────────────────────────────

function match(home, away, compCode) {
  return {
    homeTeam: home,
    awayTeam: away,
    competition: { code: compCode },
  };
}

const ARSENAL = { id: 57, name: "Arsenal FC", shortName: "Arsenal", crest: "ars.svg" };
const SPURS   = { id: 73, name: "Tottenham Hotspur FC", shortName: "Spurs", crest: "tot.svg" };
const BRAZIL  = { id: 764, name: "Brazil", shortName: "Brazil", crest: "bra.svg" };

// ── teamsFromMatches ──────────────────────────────────────────────────────────

describe("teamsFromMatches", () => {
  test("heals a placeholder club from match data", () => {
    const teams = [{ id: 57, name: "57", competitions: [] }];
    const matches = [match(ARSENAL, SPURS, "PL")];
    const [healed] = teamsFromMatches(teams, matches);
    expect(healed.name).toBe("Arsenal FC");
    expect(healed.shortName).toBe("Arsenal");
    expect(healed.crest).toBe("ars.svg");
    expect(healed.competitions).toEqual(["PL"]);
    expect(healed.national).toBe(false);
  });

  test("reads the team from whichever side it played", () => {
    const teams = [{ id: 73, name: "73", competitions: [] }];
    const matches = [match(ARSENAL, SPURS, "PL")]; // Spurs are away
    const [healed] = teamsFromMatches(teams, matches);
    expect(healed.name).toBe("Tottenham Hotspur FC");
  });

  test("unions discovered competitions with existing ones", () => {
    const teams = [{ id: 57, name: "Arsenal FC", competitions: ["CL"] }];
    const matches = [match(ARSENAL, SPURS, "PL")]; // only PL in this window
    const [healed] = teamsFromMatches(teams, matches);
    expect(healed.competitions.sort()).toEqual(["CL", "PL"]);
  });

  test("marks national teams from WC/EC competition codes", () => {
    const teams = [{ id: 764, name: "764", competitions: [] }];
    const matches = [match(BRAZIL, ARSENAL, "WC")];
    const [healed] = teamsFromMatches(teams, matches);
    expect(healed.national).toBe(true);
    expect(healed.competitions).toEqual(["WC"]);
  });

  test("keeps an existing national flag even when current matches aren't WC/EC", () => {
    // A national team added via the WC browser (national:true) whose only
    // fixtures in the window are friendlies must not be reclassified as a club.
    const teams = [{ id: 764, name: "Brazil", national: true, competitions: [] }];
    const matches = [match(BRAZIL, ARSENAL, "FRIENDLY")];
    const [healed] = teamsFromMatches(teams, matches);
    expect(healed.national).toBe(true);
  });

  test("leaves a team with no matches untouched", () => {
    const original = { id: 57, name: "57", competitions: [] };
    const [healed] = teamsFromMatches([original], []);
    expect(healed).toBe(original);
  });

  test("dedupes competitions seen across multiple matches", () => {
    const teams = [{ id: 57, name: "Arsenal FC", competitions: [] }];
    const matches = [
      match(ARSENAL, SPURS, "PL"),
      match(SPURS, ARSENAL, "PL"),
      match(ARSENAL, BRAZIL, "CL"),
    ];
    const [healed] = teamsFromMatches(teams, matches);
    expect(healed.competitions.sort()).toEqual(["CL", "PL"]);
  });
});

// ── matchingCompetitions ──────────────────────────────────────────────────────
// Regression coverage for a real bug: neither the single competition a team
// was browsed from, nor team-info's runningCompetitions (which only reflects
// competitions with fixtures fd.org has already scheduled), reliably has a
// team's complete competition list. Confirmed live: Barcelona and Inter are
// both on the Champions League roster this season, but CL had zero scheduled
// fixtures at the time, so runningCompetitions omitted it for both. Querying
// every free-tier competition's roster directly and checking membership is
// the only authoritative source — independent of fixture scheduling and of
// which browser list the team happened to be added from.

describe("matchingCompetitions", () => {
  test("returns every competition whose roster includes the team", () => {
    const rostersByCode = {
      PD: new Set([81, 90]),
      CL: new Set([81, 108]),
      SA: new Set([108]),
    };
    expect(matchingCompetitions(81, rostersByCode).sort()).toEqual(["CL", "PD"]);
  });

  test("returns an empty array when the team is in no tracked roster", () => {
    const rostersByCode = { PD: new Set([90]), SA: new Set([108]) };
    expect(matchingCompetitions(81, rostersByCode)).toEqual([]);
  });

  test("skips a roster that failed to fetch (absent from the map)", () => {
    // resolveTeamCompetitions omits a code entirely if its request failed,
    // rather than including an empty/wrong Set.
    const rostersByCode = { PD: new Set([81]) };
    expect(matchingCompetitions(81, rostersByCode)).toEqual(["PD"]);
  });
});

// ── applyResolvedCompetitions ─────────────────────────────────────────────────
// Used by the periodic competition-refresh sweep (background.js), which
// re-runs resolveTeamCompetitions for every already-tracked team so a
// competition confirmed after the team was added (e.g. a club's Champions
// League slot settling in once fd.org publishes the league-phase draw) is
// picked up automatically, without the user needing to remove and re-add the
// team. Unions rather than replaces — a competition a team already has
// recorded is never dropped just because one roster fetch missed it.

describe("applyResolvedCompetitions", () => {
  test("unions newly resolved competitions with the team's existing ones", () => {
    const team = { id: 108, name: "Inter", competitions: ["SA"] };
    const updated = applyResolvedCompetitions(team, ["SA", "CL"]);
    expect(updated.competitions.sort()).toEqual(["CL", "SA"]);
  });

  test("dedupes when the resolved list overlaps entirely", () => {
    const team = { id: 57, name: "Arsenal", competitions: ["PL"] };
    const updated = applyResolvedCompetitions(team, ["PL"]);
    expect(updated.competitions).toEqual(["PL"]);
  });

  test("never drops an existing competition, even if the resolved list omits it", () => {
    // A transient roster-fetch failure for one competition shouldn't erase a
    // previously confirmed one.
    const team = { id: 81, name: "Barcelona", competitions: ["PD", "CL"] };
    const updated = applyResolvedCompetitions(team, ["PD"]);
    expect(updated.competitions.sort()).toEqual(["CL", "PD"]);
  });

  test("flips national to true when a resolved competition is WC/EC", () => {
    const team = { id: 762, name: "Argentina", national: false, competitions: [] };
    const updated = applyResolvedCompetitions(team, ["WC"]);
    expect(updated.national).toBe(true);
  });

  test("keeps an existing national flag even when the resolved list has no WC/EC", () => {
    const team = { id: 762, name: "Argentina", national: true, competitions: ["WC"] };
    const updated = applyResolvedCompetitions(team, []);
    expect(updated.national).toBe(true);
  });

  test("preserves other fields (name, shortName, crest) unchanged", () => {
    const team = { id: 81, name: "FC Barcelona", shortName: "Barça", crest: "barca.png", competitions: ["PD"] };
    const updated = applyResolvedCompetitions(team, ["CL"]);
    expect(updated.name).toBe("FC Barcelona");
    expect(updated.shortName).toBe("Barça");
    expect(updated.crest).toBe("barca.png");
  });
});

// ── buildSweepQueue / recordSweepResult ───────────────────────────────────────
// The background competition sweep (background.js) can't safely run as one
// long function with in-process throttle sleeps — a bare setTimeout doesn't
// count as activity, so Chrome can (and, confirmed live, does) terminate the
// service worker mid-sleep, discarding all progress since nothing gets saved
// until the very end. The fix makes the sweep resumable: a flat queue of
// (team, competition) pairs persisted in chrome.storage, processed a few at a
// time, with chrome.alarms (which reliably wakes a terminated worker) used
// for the throttle pause instead of setTimeout. These two functions are the
// pure state-transition core of that queue; the storage/alarm/fetch wiring
// around them isn't unit tested, consistent with the rest of this codebase.

describe("buildSweepQueue", () => {
  test("produces one entry per team per free-tier competition", () => {
    const queue = buildSweepQueue([81, 108]);
    expect(queue).toHaveLength(2 * 11);
  });

  test("orders by team first, then competition, so one team's checks finish before the next starts", () => {
    const queue = buildSweepQueue([81, 108]);
    expect(queue[0]).toEqual({ teamId: 81, code: "PL" });
    expect(queue[10]).toEqual({ teamId: 81, code: "PPL" });
    expect(queue[11]).toEqual({ teamId: 108, code: "PL" });
  });

  test("returns an empty queue for no teams", () => {
    expect(buildSweepQueue([])).toEqual([]);
  });
});

describe("recordSweepResult", () => {
  test("adds the competition to a team's result list when matched", () => {
    const results = recordSweepResult({}, 81, "PD", true);
    expect(results).toEqual({ 81: ["PD"] });
  });

  test("leaves results unchanged when not matched", () => {
    const results = recordSweepResult({ 81: ["CL"] }, 81, "PD", false);
    expect(results).toEqual({ 81: ["CL"] });
  });

  test("appends to an existing team's list rather than overwriting it", () => {
    const results = recordSweepResult({ 81: ["CL"] }, 81, "PD", true);
    expect(results[81].sort()).toEqual(["CL", "PD"]);
  });

  test("does not mutate the input results object", () => {
    const original = { 81: ["CL"] };
    recordSweepResult(original, 81, "PD", true);
    expect(original).toEqual({ 81: ["CL"] });
  });

  test("does not duplicate a competition already recorded for that team", () => {
    const results = recordSweepResult({ 81: ["PD"] }, 81, "PD", true);
    expect(results[81]).toEqual(["PD"]);
  });
});

// ── anyCompetitionsChanged ─────────────────────────────────────────────────────
// Regression coverage for a real bug: the competition sweep correctly updated
// Barcelona's stored teamsCache to ["CL", "PD"], but the popup still showed no
// Barcelona matches — matchesCache is a separate cache with its own TTL, and
// nothing told it to refetch using the newly-completed competitions list.
// This decides whether the sweep needs to trigger that refetch.

describe("anyCompetitionsChanged", () => {
  test("true when a team's competitions grew", () => {
    const before = [{ id: 81, competitions: ["CL"] }];
    const after = [{ id: 81, competitions: ["CL", "PD"] }];
    expect(anyCompetitionsChanged(before, after)).toBe(true);
  });

  test("false when nothing changed", () => {
    const before = [{ id: 81, competitions: ["CL", "PD"] }];
    const after = [{ id: 81, competitions: ["CL", "PD"] }];
    expect(anyCompetitionsChanged(before, after)).toBe(false);
  });

  test("true when any one team in a list changed, not just the first", () => {
    const before = [{ id: 57, competitions: ["PL"] }, { id: 108, competitions: ["SA"] }];
    const after = [{ id: 57, competitions: ["PL"] }, { id: 108, competitions: ["SA", "CL"] }];
    expect(anyCompetitionsChanged(before, after)).toBe(true);
  });

  test("false for an empty list", () => {
    expect(anyCompetitionsChanged([], [])).toBe(false);
  });
});
