Object.assign(global, require("../utils"));

// api.js reads API_KEY and chrome.storage from the global scope.
global.API_KEY = "test-key";

let store;
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set: (obj, cb) => {
        Object.assign(store, obj);
        if (cb) cb();
        return Promise.resolve();
      },
    },
  },
};

const {
  fetchAllMatches,
  getRateLimitedUntil,
  rateLimitRemainingMs,
  parseRetryAfterSecs,
  fetchWithTimeout,
} = require("../api");

const TEAM = { id: 57, name: "Arsenal FC", competitions: ["PL", "CL", "PD"] };

function res(status, { headers = {}, json = { matches: [] } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => json,
  };
}

beforeEach(() => {
  store = {};
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("parseRetryAfterSecs", () => {
  test("reads the Retry-After header", () => {
    expect(parseRetryAfterSecs({ get: (k) => (k === "Retry-After" ? "42" : null) })).toBe(42);
  });
  test("falls back to the X-RequestCounter-Reset header", () => {
    expect(parseRetryAfterSecs({ get: (k) => (k === "X-RequestCounter-Reset" ? "17" : null) })).toBe(17);
  });
  test("defaults to 60s when no header is usable", () => {
    expect(parseRetryAfterSecs({ get: () => null })).toBe(60);
  });
});

describe("rateLimitRemainingMs", () => {
  test("is 0 when nothing is set or the time has passed", () => {
    expect(rateLimitRemainingMs(undefined, 1000)).toBe(0);
    expect(rateLimitRemainingMs(500, 1000)).toBe(0);
  });
  test("returns the time left", () => {
    expect(rateLimitRemainingMs(5000, 1000)).toBe(4000);
  });
});

describe("fetchAllMatches on HTTP 429", () => {
  test("stops after the first 429 instead of hammering every competition", async () => {
    global.fetch = jest.fn().mockResolvedValue(res(429, { headers: { "Retry-After": "30" } }));
    const matches = await fetchAllMatches([TEAM]);
    expect(matches).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("records a rate-limited-until time from Retry-After", async () => {
    const now = Date.now();
    global.fetch = jest.fn().mockResolvedValue(res(429, { headers: { "Retry-After": "30" } }));
    await fetchAllMatches([TEAM]);
    const until = await getRateLimitedUntil();
    expect(until).toBeGreaterThanOrEqual(now + 29_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 31_000);
  });

  test("makes no requests while a backoff is active", async () => {
    store.rateLimitedUntil = Date.now() + 30_000;
    global.fetch = jest.fn();
    const matches = await fetchAllMatches([TEAM]);
    expect(matches).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("keeps matches already fetched before the 429", async () => {
    const m = { id: 1, homeTeam: { id: 57 }, awayTeam: { id: 9 }, utcDate: "2026-12-01T15:00:00Z" };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(200, { json: { matches: [m] } }))
      .mockResolvedValue(res(429, { headers: { "Retry-After": "30" } }));
    const matches = await fetchAllMatches([TEAM]);
    expect(matches).toEqual([m]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("a failed sweep does not stamp lastCompSweep", async () => {
    global.fetch = jest.fn().mockResolvedValue(res(429));
    await fetchAllMatches([{ id: 57, name: "57", competitions: [] }]);
    expect(store.lastCompSweep).toBeUndefined();
  });
});

describe("escalating backoff", () => {
  const limited = () => res(429, { headers: { "Retry-After": "30" } });

  async function lastBackoffSecs() {
    const before = Date.now();
    await fetchAllMatches([TEAM]);
    return Math.round(((await getRateLimitedUntil()) - before) / 1000);
  }

  test("doubles the wait on consecutive 429s", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited());
    expect(await lastBackoffSecs()).toBe(30);
    store.rateLimitedUntil = 0; // backoff elapsed
    expect(await lastBackoffSecs()).toBe(60);
    store.rateLimitedUntil = 0;
    expect(await lastBackoffSecs()).toBe(120);
  });

  test("resets after a successful request", async () => {
    global.fetch = jest.fn().mockResolvedValue(limited());
    await fetchAllMatches([TEAM]);
    store.rateLimitedUntil = 0;
    global.fetch = jest.fn().mockResolvedValue(res(200));
    await fetchAllMatches([TEAM]);
    global.fetch = jest.fn().mockResolvedValue(limited());
    expect(await lastBackoffSecs()).toBe(30);
  });
});

describe("fetchWithTimeout", () => {
  test("aborts a request that never responds", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const p = fetchWithTimeout("https://example.test", {}, 1000);
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    jest.advanceTimersByTime(1001);
    await assertion;
    jest.useRealTimers();
  });
});
