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

// CommonJS export for Jest — not executed in the browser extension context
if (typeof module !== "undefined") {
  module.exports = { isoDate, localIsoDate, formatTime, formatDateLabel, dateKey, EXCLUDED_STATUSES, isVisible };
}
