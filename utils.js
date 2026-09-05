function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Local-timezone date string — use this for "today" comparisons so the
// display matches the user's clock, not UTC.
function localIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function dateKey(dateStr) {
  return new Date(dateStr).toDateString();
}

// ── Match visibility ──────────────────────────────────────────────────────────
// Shared by the popup (filterMatches) and the background worker (badge/tooltip/
// notifications) so the two can never disagree about which matches count.

// Statuses for matches that won't be played as listed and should never show.
const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

// A match is visible if it isn't excluded and at least one of its teams is both
// tracked and enabled.
function isVisible(m, trackedIds, enabledIds) {
  if (EXCLUDED_STATUSES.has(m.status)) return false;
  const homeOn = trackedIds.has(m.homeTeam.id) && enabledIds.has(m.homeTeam.id);
  const awayOn = trackedIds.has(m.awayTeam.id) && enabledIds.has(m.awayTeam.id);
  return homeOn || awayOn;
}

// ── Kickoff expiry ────────────────────────────────────────────────────────────

// The fd.org cache refreshes every 6 hours, so a FINISHED match may still
// appear as IN_PLAY in the cache. Drop it from badge / count if the kickoff
// was more than 120 minutes ago — the match is almost certainly over.
const KICKOFF_EXPIRY_MS = 120 * 60 * 1000;
function isKickoffExpired(utcDate) {
  return Date.now() - new Date(utcDate).getTime() > KICKOFF_EXPIRY_MS;
}

// ── Team grouping / sorting ───────────────────────────────────────────────────
// Sort by the label actually shown (shortName, falling back to name) so lists
// read alphabetically — e.g. "Leverkusen" under L, not B (Bayer 04 Leverkusen).
function byDisplayName(a, b) {
  return (a.shortName || a.name || "").localeCompare(b.shortName || b.name || "");
}

// Split teams into club and national groups, each sorted by display name.
// Shared by the header crest bar and the settings tracked-team chips so the two
// always order teams identically.
function groupTeams(teams) {
  return {
    clubs:    teams.filter((t) => !t.national).sort(byDisplayName),
    national: teams.filter((t) =>  t.national).sort(byDisplayName),
  };
}

// ── Badge ─────────────────────────────────────────────────────────────────────
// Shared by the popup and the background worker so both compute the same
// badge text/color from the same match list — one game(s)-today count in
// orange, or the number of days until the next tracked match (in brackets)
// in blue when nothing's on today.

const BADGE_COLOR_TODAY = "#f97316";
const BADGE_COLOR_UPCOMING = "#3b82f6";

// Whole-day difference between two YYYY-MM-DD strings. Parsing both at local
// midnight (rather than diffing raw timestamps) keeps this safe from DST.
function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  return Math.round((to - from) / 86400000);
}

function getBadgeInfo(matches, trackedIds, enabledIds, now = new Date()) {
  const todayStr = localIsoDate(now);

  const todayCount = matches.filter((m) => {
    if (!isVisible(m, trackedIds, enabledIds)) return false;
    if (localIsoDate(new Date(m.utcDate)) !== todayStr) return false;
    if (m.status === "FINISHED") return false;
    if (isKickoffExpired(m.utcDate)) return false;
    return true;
  }).length;

  if (todayCount > 0) {
    return { text: String(todayCount), color: BADGE_COLOR_TODAY };
  }

  // Assumes matches is sorted chronologically (guaranteed by api.js) so the
  // first match strictly after today is the next one.
  const nextMatch = matches.find((m) => {
    if (!isVisible(m, trackedIds, enabledIds)) return false;
    return localIsoDate(new Date(m.utcDate)) > todayStr;
  });

  if (nextMatch) {
    const days = daysBetween(todayStr, localIsoDate(new Date(nextMatch.utcDate)));
    return { text: `(${days})`, color: BADGE_COLOR_UPCOMING };
  }

  return { text: "", color: BADGE_COLOR_TODAY };
}

// CommonJS export for Jest — not executed in the browser extension context
if (typeof module !== "undefined") {
  module.exports = { isoDate, localIsoDate, formatTime, formatDateLabel, dateKey, EXCLUDED_STATUSES, isVisible, isKickoffExpired, byDisplayName, groupTeams, getBadgeInfo };
}
