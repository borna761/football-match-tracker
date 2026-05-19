// filterMatches depends on globals from utils.js — expose them before loading popup.js
const utils = require("../utils");
Object.assign(global, utils);
const { filterMatches } = require("../popup");

// filterMatches expects a local-date string (YYYY-MM-DD) from localIsoDate().
// TZ=UTC makes local === UTC so these tests are timezone-agnostic.
const TODAY = "2026-05-18";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMatch(homeId, awayId, { status = "TIMED", date = "2026-05-23T15:00:00Z" } = {}) {
  return {
    homeTeam: { id: homeId },
    awayTeam: { id: awayId },
    status,
    utcDate: date,
  };
}

// IDs used in tests
const ARSENAL   = 57;
const BARCELONA = 81;
const BURNLEY   = 999; // untracked opponent

const TRACKED  = new Set([ARSENAL, BARCELONA]);
const ALL_ON   = new Set([ARSENAL, BARCELONA]);
const NONE_ON  = new Set([]);
const ONLY_ARS = new Set([ARSENAL]);

// ── status filtering ──────────────────────────────────────────────────────────

describe("filterMatches — status filtering", () => {
  test("includes upcoming (TIMED) match", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "TIMED" });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(1);
  });

  test("excludes POSTPONED match", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "POSTPONED" });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(0);
  });

  test("excludes CANCELLED match", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "CANCELLED" });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(0);
  });

  test("excludes SUSPENDED match", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "SUSPENDED" });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(0);
  });

  test("includes IN_PLAY match", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "IN_PLAY", date: `${TODAY}T15:00:00Z` });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(1);
  });
});

// ── finished match date filtering ─────────────────────────────────────────────

describe("filterMatches — FINISHED date filtering", () => {
  test("includes FINISHED match from today", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "FINISHED", date: `${TODAY}T15:00:00Z` });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(1);
  });

  test("excludes FINISHED match from yesterday", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "FINISHED", date: "2026-05-17T15:00:00Z" });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(0);
  });

  test("excludes FINISHED match from a week ago", () => {
    const m = makeMatch(ARSENAL, BURNLEY, { status: "FINISHED", date: "2026-05-11T15:00:00Z" });
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(0);
  });
});

// ── team toggle filtering ─────────────────────────────────────────────────────

describe("filterMatches — team toggle filtering", () => {
  test("shows match when tracked home team is enabled", () => {
    const m = makeMatch(ARSENAL, BURNLEY);
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(1);
  });

  test("shows match when tracked away team is enabled", () => {
    const m = makeMatch(BURNLEY, ARSENAL);
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(1);
  });

  test("hides match when the only tracked team is disabled", () => {
    const m = makeMatch(ARSENAL, BURNLEY);
    expect(filterMatches([m], TODAY, TRACKED, NONE_ON)).toHaveLength(0);
  });

  test("shows match when one tracked team is enabled even if the other is disabled", () => {
    // Arsenal (home) enabled, Barcelona (away) disabled — but it's Arsenal's match
    const m = makeMatch(ARSENAL, BARCELONA);
    expect(filterMatches([m], TODAY, TRACKED, ONLY_ARS)).toHaveLength(1);
  });

  test("hides match when both tracked teams are disabled", () => {
    const m = makeMatch(ARSENAL, BARCELONA);
    expect(filterMatches([m], TODAY, TRACKED, NONE_ON)).toHaveLength(0);
  });

  test("hides match when neither team is tracked", () => {
    const m = makeMatch(BURNLEY, 888);
    expect(filterMatches([m], TODAY, TRACKED, ALL_ON)).toHaveLength(0);
  });

  test("returns empty list when all teams are toggled off", () => {
    const matches = [
      makeMatch(ARSENAL, BURNLEY),
      makeMatch(BARCELONA, BURNLEY),
    ];
    expect(filterMatches(matches, TODAY, TRACKED, NONE_ON)).toHaveLength(0);
  });
});
