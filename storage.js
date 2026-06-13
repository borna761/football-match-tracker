// Team cache includes the manifest version so that releasing a new version
// automatically re-fetches team metadata (name, crest, national flag).
// Match cache only depends on which teams are tracked — match data format
// doesn't change between releases, so version bumps don't bust it.
const APP_VERSION = (typeof chrome !== "undefined" && chrome.runtime)
  ? chrome.runtime.getManifest().version
  : "0";

// Fingerprints take the team-ID list explicitly so these functions are pure
// and usable from both the popup (which holds TEAM_IDS as a global) and the
// background service worker (which reads the list from storage).
function teamsFingerprint(teamIds)   { return `t:${APP_VERSION}:${teamIds.join(",")}`; }
function matchesFingerprint(teamIds) { return teamIds.join(","); }

const CACHE_TTL_MS      =      60 * 60 * 1000; // 1 hour
const TEAM_INFO_TTL_MS  =  7 * 24 * 60 * 60 * 1000; // 7 days
const COMP_CACHE_TTL_MS =  7 * 24 * 60 * 60 * 1000; // 7 days

// ── Popup-only state functions ────────────────────────────────────────────────
// loadAllState/saveTrackedIds/saveEnabledTeams read and write the popup globals
// (TEAM_IDS, TRACKED_IDS, enabledTeamIds). They are NOT safe to call from the
// background service worker, which imports this file but never defines those
// globals — calling them there throws ReferenceError. The worker uses only the
// parameterized cache helpers below (loadCache/saveCache/loadTeams/saveTeams).

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
          tc.fingerprint === teamsFingerprint(TEAM_IDS) &&
          Date.now() - tc.timestamp <= TEAM_INFO_TTL_MS
            ? tc.teams
            : null;

        // Match cache (returned raw so the caller can decide stale-while-revalidate)
        const mc = data.matchesCache;
        const matchCache =
          mc && mc.fingerprint === matchesFingerprint(TEAM_IDS) ? mc : null;

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
function loadCache(teamIds) {
  return new Promise((resolve) => {
    chrome.storage.local.get("matchesCache", (data) => {
      const cache = data.matchesCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== matchesFingerprint(teamIds)) return resolve(null);
      resolve(Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null);
    });
  });
}

function saveCache(matches, teamIds) {
  const cache = { matches, timestamp: Date.now(), fingerprint: matchesFingerprint(teamIds) };
  chrome.storage.local.set({ matchesCache: cache });
  return cache;
}

// ── Team info cache ───────────────────────────────────────────────────────────
function loadTeams(teamIds) {
  return new Promise((resolve) => {
    chrome.storage.local.get("teamsCache", (data) => {
      const cache = data.teamsCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== teamsFingerprint(teamIds)) return resolve(null);
      if (Date.now() - cache.timestamp > TEAM_INFO_TTL_MS) return resolve(null);
      resolve(cache.teams);
    });
  });
}

function saveTeams(teams, teamIds) {
  chrome.storage.local.set({
    teamsCache: { teams, timestamp: Date.now(), fingerprint: teamsFingerprint(teamIds) },
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
