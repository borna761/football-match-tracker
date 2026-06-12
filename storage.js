// Team cache includes the manifest version so that releasing a new version
// automatically re-fetches team metadata (name, crest, national flag).
// Match cache only depends on which teams are tracked — match data format
// doesn't change between releases, so version bumps don't bust it.
const APP_VERSION = (typeof chrome !== "undefined" && chrome.runtime)
  ? chrome.runtime.getManifest().version
  : "0";

function teamsFingerprint()   { return `t:${APP_VERSION}:${TEAM_IDS.join(",")}`; }
function matchesFingerprint() { return TEAM_IDS.join(","); }

const CACHE_TTL_MS      =      60 * 60 * 1000; // 1 hour
const TEAM_INFO_TTL_MS  =  7 * 24 * 60 * 60 * 1000; // 7 days
const COMP_CACHE_TTL_MS =  7 * 24 * 60 * 60 * 1000; // 7 days

// ── Bulk load on startup ──────────────────────────────────────────────────────
// Load all persisted state in a single storage read and populate globals.
// Returns the raw matchesCache entry (may be stale) for SWR use.
function loadAllState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["trackedTeamIds", "enabledTeams", "teamsCache", "matchesCache"],
      (data) => {
        // Team IDs
        TEAM_IDS = Array.isArray(data.trackedTeamIds) ? data.trackedTeamIds : [];
        TRACKED_IDS = new Set(TEAM_IDS);

        // Enabled teams
        if (Array.isArray(data.enabledTeams)) {
          enabledTeamIds = new Set(data.enabledTeams.filter((id) => TRACKED_IDS.has(id)));
        } else {
          enabledTeamIds = new Set(TEAM_IDS);
        }

        // Teams metadata cache
        const tc = data.teamsCache;
        const freshTeams =
          tc &&
          tc.fingerprint === teamsFingerprint() &&
          Date.now() - tc.timestamp <= TEAM_INFO_TTL_MS
            ? tc.teams
            : null;

        // Match cache (returned raw so the caller can decide stale-while-revalidate)
        const mc = data.matchesCache;
        const matchCache =
          mc && mc.fingerprint === matchesFingerprint() ? mc : null;

        resolve({ freshTeams, matchCache });
      }
    );
  });
}

// ── Tracked team IDs ──────────────────────────────────────────────────────────
function saveTrackedIds() {
  chrome.storage.local.set({ trackedTeamIds: TEAM_IDS });
}

// ── Enabled teams (toggle state) ──────────────────────────────────────────────
function saveEnabledTeams() {
  chrome.storage.local.set({ enabledTeams: [...enabledTeamIds] });
}

// ── Match cache ───────────────────────────────────────────────────────────────
function loadCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get("matchesCache", (data) => {
      const cache = data.matchesCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== matchesFingerprint()) return resolve(null);
      resolve(Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null);
    });
  });
}

function saveCache(matches) {
  const cache = { matches, timestamp: Date.now(), fingerprint: matchesFingerprint() };
  chrome.storage.local.set({ matchesCache: cache });
  return cache;
}

// ── Team info cache ───────────────────────────────────────────────────────────
function loadTeams() {
  return new Promise((resolve) => {
    chrome.storage.local.get("teamsCache", (data) => {
      const cache = data.teamsCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== teamsFingerprint()) return resolve(null);
      if (Date.now() - cache.timestamp > TEAM_INFO_TTL_MS) return resolve(null);
      resolve(cache.teams);
    });
  });
}

function saveTeams(teams) {
  chrome.storage.local.set({
    teamsCache: { teams, timestamp: Date.now(), fingerprint: teamsFingerprint() },
  });
}

// ── Competition teams cache ───────────────────────────────────────────────────
function loadCompCache(code) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`compTeams_${code}`, (data) => {
      const cache = data[`compTeams_${code}`];
      if (!cache) return resolve(null);
      if (Date.now() - cache.timestamp > COMP_CACHE_TTL_MS) return resolve(null);
      resolve(cache.teams);
    });
  });
}

function saveCompCache(code, teams) {
  chrome.storage.local.set({ [`compTeams_${code}`]: { teams, timestamp: Date.now() } });
}

// ── Notification preference ───────────────────────────────────────────────────
function saveNotifyBefore(minutes) {
  chrome.storage.local.set({ notifyMinutesBefore: minutes });
}
