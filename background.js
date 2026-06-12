// Background service worker — keeps the badge count current without
// requiring the popup to be open.

const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

function localIsoDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isVisible(m, trackedIds, enabledIds) {
  if (EXCLUDED_STATUSES.has(m.status)) return false;
  const homeOn = trackedIds.has(m.homeTeam.id) && enabledIds.has(m.homeTeam.id);
  const awayOn = trackedIds.has(m.awayTeam.id) && enabledIds.has(m.awayTeam.id);
  return homeOn || awayOn;
}

function formatMatchTime(utcDate) {
  return new Date(utcDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

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
    return localIsoDate(new Date(m.utcDate)) === todayStr;
  });

  const nextMatch = matches.find((m) => {
    if (!isVisible(m, trackedIds, enabledIds)) return false;
    return localIsoDate(new Date(m.utcDate)) > todayStr;
  });

  // Badge
  chrome.action.setBadgeText({ text: todayMatches.length > 0 ? String(todayMatches.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#f97316" });

  // Tooltip
  let title = "Football Match Tracker";
  if (todayMatches.length > 0) {
    const lines = todayMatches.map((m) => {
      const home = m.homeTeam.shortName || m.homeTeam.name;
      const away = m.awayTeam.shortName || m.awayTeam.name;
      return `${formatMatchTime(m.utcDate)}  ${home} vs ${away}`;
    });
    title = lines.join("\n");
  } else if (nextMatch) {
    const home = nextMatch.homeTeam.shortName || nextMatch.homeTeam.name;
    const away = nextMatch.awayTeam.shortName || nextMatch.awayTeam.name;
    title = `Next: ${home} vs ${away}\n${formatMatchDay(nextMatch.utcDate)} · ${formatMatchTime(nextMatch.utcDate)}`;
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
    const timeStr = formatMatchTime(match.utcDate);

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

// Update badge when the browser starts
chrome.runtime.onStartup.addListener(() => { updateBadge(); checkNotifications(); });

// Update badge on first install / extension reload.
// Also seed the default notification preference so background.js and
// settings.js both read from storage rather than separate hardcoded fallbacks.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("notifyMinutesBefore", (data) => {
    if (typeof data.notifyMinutesBefore !== "number") {
      chrome.storage.local.set({ notifyMinutesBefore: 15 });
    }
  });
  updateBadge();
  checkNotifications();
});

// Badge: every hour. Notifications: every minute.
chrome.alarms.create("updateBadge",        { periodInMinutes: 60 });
chrome.alarms.create("checkNotifications", { periodInMinutes:  1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "updateBadge")        updateBadge();
  if (alarm.name === "checkNotifications") checkNotifications();
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
