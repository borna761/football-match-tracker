const { isoDate, localIsoDate, formatTime, formatDateLabel, dateKey, isKickoffExpired, getBadgeInfo } = require("../utils");

// All tests run with TZ=UTC (set via npm test script)

describe("isoDate", () => {
  test("formats a Date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-18T10:00:00Z"))).toBe("2026-05-18");
  });

  test("uses the date portion only, ignoring time", () => {
    expect(isoDate(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });
});

// localIsoDate uses getFullYear/getMonth/getDate (local clock) rather than
// toISOString (UTC). In TZ=UTC these are equivalent, but in other timezones
// they diverge near midnight — a finished match from earlier in the day won't
// disappear once UTC ticks past midnight.
describe("localIsoDate", () => {
  test("formats a Date as YYYY-MM-DD", () => {
    expect(localIsoDate(new Date("2026-05-18T10:00:00Z"))).toBe("2026-05-18");
  });

  test("zero-pads month and day", () => {
    expect(localIsoDate(new Date("2026-01-05T10:00:00Z"))).toBe("2026-01-05");
  });

  test("matches isoDate when timezone is UTC", () => {
    const d = new Date("2026-05-18T15:00:00Z");
    expect(localIsoDate(d)).toBe(isoDate(d));
  });

  test("handles end-of-year dates", () => {
    expect(localIsoDate(new Date("2026-12-31T23:00:00Z"))).toBe("2026-12-31");
  });
});

describe("formatTime", () => {
  test("formats a UTC timestamp as HH:MM (24h)", () => {
    expect(formatTime("2026-05-18T15:00:00Z")).toBe("15:00");
  });

  test("pads single-digit hours and minutes", () => {
    expect(formatTime("2026-05-18T09:05:00Z")).toBe("09:05");
  });

  test("formats an evening kick-off correctly", () => {
    expect(formatTime("2026-05-18T20:45:00Z")).toBe("20:45");
  });
});

describe("formatDateLabel", () => {
  const FIXED_NOW = "2026-05-18T12:00:00Z";

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns "Today" for a match on the current date', () => {
    expect(formatDateLabel("2026-05-18T19:00:00Z")).toBe("Today");
  });

  test('returns "Tomorrow" for a match on the next date', () => {
    expect(formatDateLabel("2026-05-19T15:00:00Z")).toBe("Tomorrow");
  });

  test("returns a formatted date string for other upcoming dates", () => {
    const label = formatDateLabel("2026-05-23T15:00:00Z");
    expect(label).toMatch(/May/);
    expect(label).toMatch(/23/);
  });

  test('does not return "Today" or "Tomorrow" for past dates', () => {
    const label = formatDateLabel("2026-05-10T10:00:00Z");
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Tomorrow");
  });
});

describe("dateKey", () => {
  test("returns the same key for two matches on the same day", () => {
    expect(dateKey("2026-05-18T10:00:00Z")).toBe(dateKey("2026-05-18T22:00:00Z"));
  });

  test("returns different keys for matches on different days", () => {
    expect(dateKey("2026-05-18T10:00:00Z")).not.toBe(dateKey("2026-05-19T10:00:00Z"));
  });

  test("returns a consistent string (usable as a grouping key)", () => {
    const key = dateKey("2026-05-18T15:00:00Z");
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });
});

describe("isKickoffExpired", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-18T20:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns false for a kickoff 60 minutes ago", () => {
    expect(isKickoffExpired("2026-05-18T19:00:00Z")).toBe(false);
  });

  test("returns false for a kickoff exactly 120 minutes ago", () => {
    expect(isKickoffExpired("2026-05-18T18:00:00Z")).toBe(false);
  });

  test("returns true for a kickoff 121 minutes ago", () => {
    expect(isKickoffExpired("2026-05-18T17:59:00Z")).toBe(true);
  });

  test("returns true for a kickoff several hours ago", () => {
    expect(isKickoffExpired("2026-05-18T10:00:00Z")).toBe(true);
  });

  test("returns false for a future kickoff", () => {
    expect(isKickoffExpired("2026-05-18T21:00:00Z")).toBe(false);
  });
});

describe("getBadgeInfo", () => {
  const NOW = new Date("2026-05-18T12:00:00Z");
  const trackedIds = new Set([1, 2]);
  const enabledIds = new Set([1, 2]);

  function match({ id, utcDate, status = "SCHEDULED", homeId = 1, awayId = 99 }) {
    return {
      id,
      utcDate,
      status,
      homeTeam: { id: homeId, name: "Home" },
      awayTeam: { id: awayId, name: "Away" },
    };
  }

  // isKickoffExpired reads the real clock, so it needs to be faked too —
  // passing `now` only affects what getBadgeInfo treats as "today".
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("shows today's match count in the today color", () => {
    const matches = [
      match({ id: 1, utcDate: "2026-05-18T15:00:00Z" }),
      match({ id: 2, utcDate: "2026-05-18T18:00:00Z" }),
    ];
    expect(getBadgeInfo(matches, trackedIds, enabledIds, NOW)).toEqual({
      text: "2",
      color: "#f97316",
    });
  });

  test("shows days until the next match, in brackets, in the upcoming color", () => {
    const matches = [match({ id: 1, utcDate: "2026-05-21T15:00:00Z" })];
    expect(getBadgeInfo(matches, trackedIds, enabledIds, NOW)).toEqual({
      text: "(3)",
      color: "#3b82f6",
    });
  });

  test("prefers today's matches over a later upcoming match", () => {
    const matches = [
      match({ id: 1, utcDate: "2026-05-18T15:00:00Z" }),
      match({ id: 2, utcDate: "2026-05-21T15:00:00Z" }),
    ];
    expect(getBadgeInfo(matches, trackedIds, enabledIds, NOW)).toEqual({
      text: "1",
      color: "#f97316",
    });
  });

  test("ignores a finished or kickoff-expired match today when picking the next match", () => {
    const matches = [
      match({ id: 1, utcDate: "2026-05-18T08:00:00Z", status: "FINISHED" }),
      match({ id: 2, utcDate: "2026-05-20T15:00:00Z" }),
    ];
    expect(getBadgeInfo(matches, trackedIds, enabledIds, NOW)).toEqual({
      text: "(2)",
      color: "#3b82f6",
    });
  });

  test("ignores matches for untracked or disabled teams", () => {
    const matches = [match({ id: 1, utcDate: "2026-05-21T15:00:00Z", homeId: 42, awayId: 43 })];
    expect(getBadgeInfo(matches, trackedIds, enabledIds, NOW)).toEqual({
      text: "",
      color: "#f97316",
    });
  });

  test("shows nothing when there are no tracked matches at all", () => {
    expect(getBadgeInfo([], trackedIds, enabledIds, NOW)).toEqual({
      text: "",
      color: "#f97316",
    });
  });
});

