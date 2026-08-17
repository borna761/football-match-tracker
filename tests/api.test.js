const { teamsFromMatches, matchingCompetitions } = require("../api");

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
