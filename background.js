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

// Update badge when the browser starts
chrome.runtime.onStartup.addListener(updateBadge);

// Update badge on first install / extension reload
chrome.runtime.onInstalled.addListener(updateBadge);

// Update badge every hour so it stays current as the day rolls over
chrome.alarms.create("updateBadge", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "updateBadge") updateBadge();
});

// Update badge immediately whenever the popup writes new match or team data
chrome.storage.onChanged.addListener((changes) => {
  if (changes.matchesCache || changes.trackedTeamIds || changes.enabledTeams) {
    updateBadge();
  }
});
