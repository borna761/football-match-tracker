// Background service worker — keeps the badge count current without
// requiring the popup to be open.

const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

function localIsoDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function updateBadge() {
  const data = await chrome.storage.local.get(["matchesCache", "trackedTeamIds", "enabledTeams"]);
  const matches    = data.matchesCache?.matches ?? [];
  const trackedIds = new Set(data.trackedTeamIds ?? []);
  // If the user has never toggled anything, all tracked teams are enabled
  const enabledIds = new Set(
    Array.isArray(data.enabledTeams) ? data.enabledTeams : [...trackedIds]
  );

  const todayStr = localIsoDate(new Date());

  const todayCount = matches.filter((m) => {
    if (EXCLUDED_STATUSES.has(m.status)) return false;
    if (localIsoDate(new Date(m.utcDate)) !== todayStr) return false;
    const homeOn = trackedIds.has(m.homeTeam.id) && enabledIds.has(m.homeTeam.id);
    const awayOn = trackedIds.has(m.awayTeam.id) && enabledIds.has(m.awayTeam.id);
    return homeOn || awayOn;
  }).length;

  chrome.action.setBadgeText({ text: todayCount > 0 ? String(todayCount) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#f97316" });
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
