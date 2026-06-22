// Background service worker — keeps the badge, tooltip, and notifications
// current without requiring the popup to be open. It can fetch match data
// independently via the shared data layer below, so the badge works even on a
// cold browser start where the popup has never been opened.
//
// localIsoDate/isoDate (utils.js), API_KEY (config.js), the cache helpers
// (storage.js), and the fetch helpers (api.js) are shared verbatim with the
// popup — imported here so there is a single implementation of each.
importScripts("utils.js", "config.js", "storage.js", "api.js");

// EXCLUDED_STATUSES, isVisible, localIsoDate, isoDate, and formatTime all come
// from utils.js (imported above) — shared verbatim with the popup.

function formatMatchDay(utcDate) {
  return new Date(utcDate).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

async function updateBadge() {
  const data = await chrome.storage.local.get(["matchesCache", "trackedTeamIds", "enabledTeams"]);
  const trackedIds = new Set(data.trackedTeamIds ?? []);

  // If teams are tracked but the cache is absent (e.g. just been cleared after
  // adding a team), leave the badge as-is — it will update once the popup
  // re-fetches and writes a new cache.
  if (trackedIds.size > 0 && !data.matchesCache) return;

  const matches = data.matchesCache?.matches ?? [];
  // If the user has never toggled anything, all tracked teams are enabled
  const enabledIds = new Set(
    Array.isArray(data.enabledTeams) ? data.enabledTeams : [...trackedIds]
  );

  const todayStr = localIsoDate(new Date());

  const todayMatches = matches.filter((m) => {
    if (!isVisible(m, trackedIds, enabledIds)) return false;
    if (localIsoDate(new Date(m.utcDate)) !== todayStr) return false;
    if (m.status === "FINISHED") return false;
    if (isKickoffExpired(m.utcDate)) return false; // cache may be stale; drop matches >120 min past kickoff
    return true;
  });

  const nextMatch = matches.find((m) => {
    if (!isVisible(m, trackedIds, enabledIds)) return false;
    return localIsoDate(new Date(m.utcDate)) > todayStr;
  });

  // Badge
  chrome.action.setBadgeText({ text: todayMatches.length > 0 ? String(todayMatches.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#f97316" });

  // Tooltip
  const label = (m) => {
    const home = m.homeTeam.shortName || m.homeTeam.name;
    const away = m.awayTeam.shortName || m.awayTeam.name;
    const comp = m.competition?.name ? ` (${m.competition.name})` : "";
    return `${home} vs ${away}${comp}`;
  };
  let title = "Football Match Tracker";
  if (todayMatches.length > 0) {
    title = todayMatches.map((m) => `${formatTime(m.utcDate)}  ${label(m)}`).join("\n");
  } else if (nextMatch) {
    title = `Next: ${label(nextMatch)}\n${formatMatchDay(nextMatch.utcDate)} · ${formatTime(nextMatch.utcDate)}`;
  }
  chrome.action.setTitle({ title });
}

// ── Notifications ─────────────────────────────────────────────────────────────
async function checkNotifications() {
  const data = await chrome.storage.local.get([
    "matchesCache", "trackedTeamIds", "enabledTeams",
    "notifyMinutesBefore", "notifiedMatchIds",
  ]);

  // Default 15 is written to storage by onInstalled; the fallback here is a
  // safety net for the very first run before onInstalled has completed.
  const notifyBefore = typeof data.notifyMinutesBefore === "number"
    ? data.notifyMinutesBefore
    : 15;
  if (notifyBefore === -1) return;

  const trackedIds = new Set(data.trackedTeamIds ?? []);
  if (trackedIds.size === 0 || !data.matchesCache) return;

  const enabledIds = new Set(
    Array.isArray(data.enabledTeams) ? data.enabledTeams : [...trackedIds]
  );

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  // Purge notification records older than 24 hours
  const notified = {};
  for (const [id, ts] of Object.entries(data.notifiedMatchIds ?? {})) {
    if (ts > cutoff) notified[id] = ts;
  }

  let changed = Object.keys(notified).length !== Object.keys(data.notifiedMatchIds ?? {}).length;

  for (const match of (data.matchesCache.matches ?? [])) {
    if (match.status !== "TIMED" && match.status !== "SCHEDULED") continue;
    if (!isVisible(match, trackedIds, enabledIds)) continue;

    const matchId = String(match.id);
    if (notified[matchId]) continue;

    const minsUntil = (new Date(match.utcDate).getTime() - now) / 60_000;
    // +1 gives a 1-minute grace window for alarm granularity; ensures
    // notifyBefore=0 ("at kickoff") can still fire before the match starts.
    if (minsUntil > notifyBefore + 1 || minsUntil < -2) continue;

    const home = match.homeTeam.shortName || match.homeTeam.name;
    const away = match.awayTeam.shortName || match.awayTeam.name;
    const timeStr = formatTime(match.utcDate);

    const title = notifyBefore === 0
      ? "Match starting now"
      : notifyBefore === 60
        ? "Match starts in 1 hour"
        : `Match starts in ${notifyBefore} min`;

    chrome.notifications.create(`match-${matchId}`, {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title,
      message: `${home} vs ${away} (${match.competition.name}) · ${timeStr}`,
    });

    notified[matchId] = now;
    changed = true;
  }

  if (changed) {
    // Re-read before writing to avoid last-writer-wins clobbering a concurrent
    // checkNotifications execution that may have written new entries between our
    // initial get and now.
    chrome.storage.local.get("notifiedMatchIds", (latest) => {
      const merged = { ...latest.notifiedMatchIds ?? {}, ...notified };
      // Re-apply purge to any stale entries that arrived via the re-read.
      for (const [id, ts] of Object.entries(merged)) {
        if (ts <= cutoff) delete merged[id];
      }
      chrome.storage.local.set({ notifiedMatchIds: merged });
    });
  }
}

// ── Independent match refresh ─────────────────────────────────────────────────
// Fetch fresh match data directly from the API when the cache is missing or
// stale, so the badge/notifications work without the popup ever being opened.
// Only fetches when stale to respect the 10 req/min API limit and avoid racing
// the popup's own fetch.
// Returns true if it wrote a fresh cache, false otherwise (no teams, cache
// still fresh, empty fetch, or the tracked set changed mid-fetch).
async function refreshMatches() {
  const { trackedTeamIds } = await chrome.storage.local.get("trackedTeamIds");
  const teamIds = Array.isArray(trackedTeamIds) ? trackedTeamIds : [];
  if (teamIds.length === 0) return false;

  if (await loadCache(teamIds)) return false; // cache is present and fresh

  // Start from cached team records if present, else bare id records. We never
  // call /v4/teams/{id} here — it 403s for clubs in restricted competitions.
  // Names and competitions are derived from match data below instead.
  let teams = await loadTeams(teamIds);
  if (!teams) teams = teamIds.map((id) => ({ id, name: String(id), competitions: [] }));

  const matches = await fetchAllMatches(teams);
  // Don't overwrite a good cache with an empty result from a rate-limited fetch.
  if (matches.length === 0) return false;

  // The tracked set may have changed (popup added/removed a team) while we were
  // fetching. Don't clobber the popup's fresh cache with one signed for the old
  // set — bail and let the next cycle (or the popup) handle the new set.
  const { trackedTeamIds: current } = await chrome.storage.local.get("trackedTeamIds");
  if ((Array.isArray(current) ? current : []).join(",") !== teamIds.join(",")) return false;

  // Heal team records (names/crests/competitions) from the match data so the
  // next refresh queries only the relevant competitions instead of sweeping.
  saveTeams(teamsFromMatches(teams, matches));
  saveCache(matches, teamIds);
  return true; // wrote a new cache
}

// Refresh data, then update the badge/tooltip and fire any due notifications.
async function refreshAndUpdate() {
  let wrote = false;
  try {
    wrote = await refreshMatches();
  } catch (err) {
    console.error("refreshMatches failed:", err);
  }
  // When we wrote a new cache, the storage.onChanged listener already runs
  // updateBadge + checkNotifications — so only do it here when nothing was
  // written (cache was fresh), to avoid a redundant double pass.
  if (!wrote) {
    updateBadge();
    checkNotifications();
  }
}

// Register the periodic alarms. Called from onStartup and onInstalled — not at
// the top level — so the countdown isn't reset on every service-worker wake-up.
function ensureAlarms() {
  // Fetch fresh match data every 6 hours. Fixtures change slowly and the
  // 1-minute tick keeps the badge current from cache (incl. midnight), so this
  // stays well clear of the API rate limit. Trade-off: if the popup is never
  // opened, cached data can lag reality by up to ~6 hours — the badge handles
  // this by dropping matches whose kickoff was >120 min ago.
  // Clear before re-creating so a period change takes effect immediately
  // rather than being silently ignored by chrome.alarms.create.
  chrome.alarms.clear("refreshMatches", () => {
    chrome.alarms.create("refreshMatches", { periodInMinutes: 360 });
  });
  chrome.alarms.clear("checkNotifications", () => {
    chrome.alarms.create("checkNotifications", { periodInMinutes: 1 });
  });
}

// Update badge when the browser starts
chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  refreshAndUpdate();
});

// First install / extension reload.
// Also seed the default notification preference so background.js and
// settings.js both read from storage rather than separate hardcoded fallbacks.
chrome.runtime.onInstalled.addListener(() => {
  // Clear the obsolete hourly alarm from versions ≤1.7 (renamed to refreshMatches).
  chrome.alarms.clear("updateBadge");
  ensureAlarms();
  chrome.storage.local.get("notifyMinutesBefore", (data) => {
    if (typeof data.notifyMinutesBefore !== "number") {
      chrome.storage.local.set({ notifyMinutesBefore: 15 });
    }
  });
  refreshAndUpdate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  // Every 6 hours: refresh the cache from the API, then update badge/notifications.
  if (alarm.name === "refreshMatches") refreshAndUpdate();
  // Every minute: fire due notifications and keep the badge current across
  // midnight. No fetch here — that would blow the API rate limit.
  if (alarm.name === "checkNotifications") { checkNotifications(); updateBadge(); }
});

// Update badge immediately whenever the popup writes new match or team data.
// Also re-check notifications when the preference changes.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.matchesCache || changes.trackedTeamIds || changes.enabledTeams) {
    updateBadge();
  }
  if (changes.matchesCache || changes.notifyMinutesBefore) {
    checkNotifications();
  }
});
