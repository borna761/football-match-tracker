const { normalizeTeam, getFotmobData, isMatchInProgress, _namesMatch, _teamVariants } = require("../fotmob");

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
});
