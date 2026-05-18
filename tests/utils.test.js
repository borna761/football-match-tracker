const { isoDate, formatTime, formatDateLabel, dateKey } = require("../utils");

// All tests run with TZ=UTC (set via npm test script)

describe("isoDate", () => {
  test("formats a Date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-18T10:00:00Z"))).toBe("2026-05-18");
  });

  test("uses the date portion only, ignoring time", () => {
    expect(isoDate(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
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
