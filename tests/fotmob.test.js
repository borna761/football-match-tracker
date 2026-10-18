// fotmob.js uses isoDate / isKickoffExpired from utils.js as globals (loaded before it in popup.html)
Object.assign(global, require("../utils"));
const { normalizeTeam, getFotmobData, isMatchInProgress: inProgressFor, matchPhase, finalScore, parseFotmobMatch, _namesMatch, _teamVariants } = require("../fotmob");

const RECENT = () => new Date().toISOString();
const LONG_AGO = () => new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
// Wrapper so the status-based cases below read the same as before.
function isMatchInProgress(status, fotmobData, kickoffExpired = false) {
  return inProgressFor({ status, utcDate: kickoffExpired ? LONG_AGO() : RECENT() }, fotmobData);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeMatch(homeName, awayName, { homeShort, awayShort } = {}) {
  return {
    homeTeam: { name: homeName, shortName: homeShort ?? null },
    awayTeam: { name: awayName, shortName: awayShort ?? null },
  };
}

function makeEntry(id, { ongoing = false, homeScore, awayScore, minute } = {}) {
  return {
    url: `https://www.fotmob.com/match/${id}`,
    live: ongoing ? { home: homeScore ?? 0, away: awayScore ?? 0, minute: minute ?? null } : null,
  };
}

// ── normalizeTeam ─────────────────────────────────────────────────────────────

describe("normalizeTeam", () => {
  test("lowercases and strips whitespace", () => {
    expect(normalizeTeam("Arsenal")).toBe("arsenal");
  });

  test("strips common prefixes: FC, AFC, AC, SC, BSC, FK, RB", () => {
    expect(normalizeTeam("FC Barcelona")).toBe("barcelona");
    expect(normalizeTeam("AFC Bournemouth")).toBe("bournemouth");
    expect(normalizeTeam("AC Milan")).toBe("milan");
    expect(normalizeTeam("RB Leipzig")).toBe("leipzig");
  });

  test("strips non-alphanumeric characters (accented chars are dropped)", () => {
    expect(normalizeTeam("Atlético Madrid")).toBe("atlticomadrid");
    expect(normalizeTeam("Paris Saint-Germain")).toBe("parissaintgermain");
  });

  test("handles a long name like FC Internazionale Milano", () => {
    expect(normalizeTeam("FC Internazionale Milano")).toBe("internazionalemilano");
  });

  test("returns empty string for null (fd.org occasionally omits team names)", () => {
    expect(normalizeTeam(null)).toBe("");
  });

  test("returns empty string for undefined", () => {
    expect(normalizeTeam(undefined)).toBe("");
  });
});

// ── _namesMatch ───────────────────────────────────────────────────────────────

describe("_namesMatch", () => {
  test("exact match", () => {
    expect(_namesMatch("arsenal", "arsenal")).toBe(true);
  });

  test("substring: longer contains shorter", () => {
    expect(_namesMatch("internazionalemilano", "inter")).toBe(true);
  });

  test("substring: shorter contained in longer", () => {
    expect(_namesMatch("inter", "internazionalemilano")).toBe(true);
  });

  test("matches short names like Roma (4 chars) contained in longer FotMob name", () => {
    expect(_namesMatch("roma", "asroma")).toBe(true);
  });

  test("no match for clearly different teams", () => {
    expect(_namesMatch("arsenal", "chelsea")).toBe(false);
  });

  test("no match when shared name is under 4 chars", () => {
    expect(_namesMatch("ac", "acmilan")).toBe(false);
  });

  test("no false positive for teams sharing a long common prefix (Sporting CP vs Lisbon)", () => {
    expect(_namesMatch("sportingcp", "sportinglisbon")).toBe(false);
  });
});

// ── _teamVariants ─────────────────────────────────────────────────────────────

describe("_teamVariants", () => {
  test("returns just the name when shortName is absent", () => {
    expect(_teamVariants({ name: "Arsenal", shortName: null })).toEqual(["arsenal"]);
  });

  test("returns both variants when shortName differs from name", () => {
    expect(_teamVariants({ name: "Paris Saint-Germain", shortName: "PSG" }))
      .toEqual(["parissaintgermain", "psg"]);
  });

  test("deduplicates when shortName normalises to the same value as name", () => {
    expect(_teamVariants({ name: "Arsenal", shortName: "Arsenal" })).toEqual(["arsenal"]);
  });
});

// ── getFotmobData — direct match ──────────────────────────────────────────────

describe("getFotmobData — direct match", () => {
  test("returns the entry when names match exactly after normalisation", () => {
    const map = { "arsenal|burnley": makeEntry(999) };
    const result = getFotmobData(makeMatch("Arsenal", "Burnley"), map);
    expect(result.url).toBe("https://www.fotmob.com/match/999");
  });

  test("returns live data when the match is ongoing", () => {
    const map = {
      "arsenal|burnley": makeEntry(999, { ongoing: true, homeScore: 2, awayScore: 1, minute: "67'" }),
    };
    const result = getFotmobData(makeMatch("Arsenal", "Burnley"), map);
    expect(result.live).toEqual({ home: 2, away: 1, minute: "67'" });
  });

  test("live is null for a non-ongoing match", () => {
    const map = { "arsenal|burnley": makeEntry(999, { ongoing: false }) };
    const result = getFotmobData(makeMatch("Arsenal", "Burnley"), map);
    expect(result.live).toBeNull();
  });
});

// ── getFotmobData — shortName fallback ───────────────────────────────────────

describe("getFotmobData — shortName fallback", () => {
  test("matches via shortName when FotMob uses the abbreviation (PSG case)", () => {
    // football-data: name="Paris Saint-Germain", shortName="PSG"
    // FotMob key uses "PSG" → "psg"
    const map = { "psg|arsenal": makeEntry(99) };
    const match = {
      homeTeam: { name: "Paris Saint-Germain", shortName: "PSG" },
      awayTeam: { name: "Arsenal", shortName: "Arsenal" },
    };
    expect(getFotmobData(match, map).url).toBe("https://www.fotmob.com/match/99");
  });
});

// ── getFotmobData — substring fallback ───────────────────────────────────────

describe("getFotmobData — substring fallback", () => {
  test("matches when FotMob uses short name and football-data uses full name", () => {
    // FotMob key: "inter|milan" (short), football-data name: "FC Internazionale Milano"
    const map = { "inter|burnley": makeEntry(42) };
    const result = getFotmobData(makeMatch("FC Internazionale Milano", "Burnley"), map);
    expect(result.url).toBe("https://www.fotmob.com/match/42");
  });

  test("matches when football-data uses short name and FotMob uses full name", () => {
    const map = { "barcelonafc|arsenal": makeEntry(7) };
    const result = getFotmobData(makeMatch("Barcelona", "Arsenal"), map);
    expect(result.url).toBe("https://www.fotmob.com/match/7");
  });
});

// ── getFotmobData — fallback to search ───────────────────────────────────────

describe("getFotmobData — search fallback", () => {
  test("returns a FotMob search URL when no match is found in the map", () => {
    const result = getFotmobData(makeMatch("Liverpool", "Chelsea"), {});
    expect(result.url).toContain("fotmob.com/search");
    expect(result.url).toContain("Liverpool");
    expect(result.live).toBeNull();
  });

  test("uses shortName in the search URL when available", () => {
    const result = getFotmobData(
      makeMatch("Liverpool FC", "Chelsea FC", { homeShort: "Liverpool", awayShort: "Chelsea" }),
      {}
    );
    expect(result.url).toContain("Liverpool");
    expect(result.url).not.toContain("Liverpool FC");
  });
});

describe("isMatchInProgress", () => {
  const withLive = { live: { home: 1, away: 0, minute: "67" } };
  const noLive   = { live: null };

  test("IN_PLAY is in progress regardless of fotmob data", () => {
    expect(isMatchInProgress("IN_PLAY", noLive)).toBe(true);
    expect(isMatchInProgress("IN_PLAY", withLive)).toBe(true);
  });

  test("PAUSED (half-time) is in progress", () => {
    expect(isMatchInProgress("PAUSED", noLive)).toBe(true);
  });

  test("FINISHED is never in progress", () => {
    expect(isMatchInProgress("FINISHED", withLive)).toBe(false);
    expect(isMatchInProgress("FINISHED", noLive)).toBe(false);
  });

  test("TIMED with FotMob live data is in progress (stale fd.org cache)", () => {
    expect(isMatchInProgress("TIMED", withLive)).toBe(true);
  });

  test("TIMED without FotMob live data is not in progress", () => {
    expect(isMatchInProgress("TIMED", noLive)).toBe(false);
  });

  test("SCHEDULED without FotMob live data is not in progress", () => {
    expect(isMatchInProgress("SCHEDULED", noLive)).toBe(false);
  });

  // The fd.org cache refreshes every 6 hours, so a long-finished match can
  // still read IN_PLAY / PAUSED. Once kickoff has expired, only FotMob can
  // vouch that it's still live.
  test("stale IN_PLAY past kickoff expiry without FotMob live data is not in progress", () => {
    expect(isMatchInProgress("IN_PLAY", noLive, true)).toBe(false);
  });

  test("stale PAUSED past kickoff expiry without FotMob live data is not in progress", () => {
    expect(isMatchInProgress("PAUSED", noLive, true)).toBe(false);
  });

  test("IN_PLAY past kickoff expiry is still in progress when FotMob says it's live", () => {
    expect(isMatchInProgress("IN_PLAY", withLive, true)).toBe(true);
  });

  test("IN_PLAY before kickoff expiry stays in progress without FotMob live data", () => {
    expect(isMatchInProgress("IN_PLAY", noLive, false)).toBe(true);
  });
});

describe("parseFotmobMatch", () => {
  const base = { id: 4506, home: { name: "Nottingham Forest", score: 0 }, away: { name: "Arsenal", score: 1 } };

  test("finished match exposes the full-time score and is not live", () => {
    const r = parseFotmobMatch({ ...base, status: { finished: true, started: true, ongoing: false } });
    expect(r.finished).toEqual({ home: 0, away: 1 });
    expect(r.live).toBeNull();
    expect(r.url).toBe("https://www.fotmob.com/match/4506");
  });

  test("ongoing match has live data and no finished score", () => {
    const r = parseFotmobMatch({ ...base, status: { ongoing: true, liveTime: { short: "67'" } } });
    expect(r.live).toEqual({ home: 0, away: 1, minute: "67'" });
    expect(r.finished).toBeNull();
  });

  test("not-started match has neither", () => {
    const r = parseFotmobMatch({ ...base, status: {} });
    expect(r.live).toBeNull();
    expect(r.finished).toBeNull();
  });

  test("cancelled match is not reported as finished", () => {
    const r = parseFotmobMatch({ ...base, status: { finished: true, cancelled: true } });
    expect(r.finished).toBeNull();
  });
});

describe("isMatchInProgress — FotMob finished", () => {
  const finished = { live: null, finished: { home: 0, away: 1 } };

  test("stale IN_PLAY is not in progress when FotMob says finished", () => {
    expect(isMatchInProgress("IN_PLAY", finished)).toBe(false);
  });

  test("stale PAUSED is not in progress when FotMob says finished", () => {
    expect(isMatchInProgress("PAUSED", finished)).toBe(false);
  });

  test("stale TIMED is not in progress when FotMob says finished", () => {
    expect(isMatchInProgress("TIMED", finished)).toBe(false);
  });
});

describe("getFotmobData — date-qualified keys", () => {
  const D1 = "2026-10-18", D2 = "2026-10-21";
  const withDate = (utcDate) => ({ ...makeMatch("Arsenal", "Burnley"), utcDate });

  test("picks the entry for the match's own date when the same teams meet twice", () => {
    const map = {
      [`${D1}|arsenal|burnley`]: { ...makeEntry(1), finished: { home: 2, away: 0 } },
      [`${D2}|arsenal|burnley`]: { ...makeEntry(2), finished: null },
    };
    expect(getFotmobData(withDate(`${D2}T19:00:00Z`), map).finished).toBeNull();
    expect(getFotmobData(withDate(`${D1}T15:00:00Z`), map).finished).toEqual({ home: 2, away: 0 });
  });

  test("fuzzy match is also restricted to the match's date", () => {
    const map = { [`${D1}|inter|burnley`]: makeEntry(42) };
    const m = { ...makeMatch("FC Internazionale Milano", "Burnley"), utcDate: `${D2}T19:00:00Z` };
    expect(getFotmobData(m, map).url).toContain("fotmob.com/search");
  });

  test("falls back to search when the only entry is for another date", () => {
    const map = { [`${D1}|arsenal|burnley`]: makeEntry(1) };
    expect(getFotmobData(withDate(`${D2}T19:00:00Z`), map).url).toContain("fotmob.com/search");
  });
});

describe("matchPhase", () => {
  const live = { live: { home: 1, away: 0, minute: "67'" }, finished: null };
  const none = { live: null, finished: null };
  const done = { live: null, finished: { home: 0, away: 1 } };
  const m = (status, utcDate = RECENT()) => ({ status, utcDate });

  test("FINISHED is finished", () => expect(matchPhase(m("FINISHED"), none)).toBe("finished"));
  test("FotMob finished overrides a stale IN_PLAY", () => expect(matchPhase(m("IN_PLAY", LONG_AGO()), done)).toBe("finished"));
  test("recent IN_PLAY is live", () => expect(matchPhase(m("IN_PLAY"), none)).toBe("live"));
  test("recent PAUSED is halftime", () => expect(matchPhase(m("PAUSED"), none)).toBe("halftime"));
  test("TIMED with FotMob live data is live", () => expect(matchPhase(m("TIMED"), live)).toBe("live"));
  test("TIMED without live data is scheduled", () => expect(matchPhase(m("TIMED"), none)).toBe("scheduled"));
  test("expired IN_PLAY with FotMob live data is still live", () => expect(matchPhase(m("IN_PLAY", LONG_AGO()), live)).toBe("live"));
  test("expired IN_PLAY with no FotMob data is finished-unconfirmed, not scheduled", () => {
    expect(matchPhase(m("IN_PLAY", LONG_AGO()), none)).toBe("finished-unconfirmed");
  });
  test("expired PAUSED with no FotMob data is finished-unconfirmed", () => {
    expect(matchPhase(m("PAUSED", LONG_AGO()), none)).toBe("finished-unconfirmed");
  });
});

describe("isMatchInProgress — match object", () => {
  test("live and halftime count, finished-unconfirmed does not", () => {
    const none = { live: null, finished: null };
    expect(inProgressFor({ status: "IN_PLAY", utcDate: RECENT() }, none)).toBe(true);
    expect(inProgressFor({ status: "PAUSED", utcDate: RECENT() }, none)).toBe(true);
    expect(inProgressFor({ status: "IN_PLAY", utcDate: LONG_AGO() }, none)).toBe(false);
  });
});

describe("finalScore", () => {
  test("uses fd.org's full-time score when status is FINISHED", () => {
    const m = { status: "FINISHED", score: { fullTime: { home: 3, away: 1 } } };
    expect(finalScore(m, { finished: { home: 9, away: 9 } })).toEqual({ home: 3, away: 1 });
  });
  test("uses FotMob's score when fd.org is stale", () => {
    const m = { status: "IN_PLAY", score: { fullTime: { home: null, away: null } } };
    expect(finalScore(m, { finished: { home: 0, away: 1 } })).toEqual({ home: 0, away: 1 });
  });
  test("is null when neither source has a final score", () => {
    expect(finalScore({ status: "IN_PLAY", score: {} }, { finished: null })).toBeNull();
  });
});
