// Match cache depends only on which teams are tracked.
function matchesFingerprint(teamIds) { return teamIds.join(","); }

const CACHE_TTL_MS      =      60 * 60 * 1000; // 1 hour
const COMP_CACHE_TTL_MS =  7 * 24 * 60 * 60 * 1000; // 7 days

// Team records (name, crest, national flag, competitions) are durable display
// state, not a refreshable cache: a club's /v4/teams/{id} endpoint 403s when it's
// in a restricted competition, so a lost name can't always be re-fetched. We set
// records when a team is added (from the competition browser) and enrich them
// from match data — never discard them on a version bump or TTL. On load we
// reuse records by id for currently-tracked teams and drop the rest.
function salvageTeams(cachedTeams, teamIds) {
  const byId = new Map((cachedTeams || []).map((t) => [t.id, t]));
  return teamIds.map((id) => byId.get(id) || { id, name: String(id), competitions: [] });
}

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

        // Durable team records, reused by id (bare placeholder for any missing).
        const freshTeams = salvageTeams(data.teamsCache?.teams, TEAM_IDS);

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

// ── Team records (durable) ────────────────────────────────────────────────────
// Reused by id and never discarded on version/TTL — see salvageTeams above.
// Returns null only when nothing is cached yet, so the caller falls back to
// bare records that match data then heals.
function loadTeams(teamIds) {
  return new Promise((resolve) => {
    chrome.storage.local.get("teamsCache", (data) => {
      const teams = data.teamsCache?.teams;
      if (!Array.isArray(teams)) return resolve(null);
      resolve(salvageTeams(teams, teamIds));
    });
  });
}

function saveTeams(teams) {
  chrome.storage.local.set({ teamsCache: { teams, timestamp: Date.now() } });
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
