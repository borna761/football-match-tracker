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

// ── Live-match helpers ────────────────────────────────────────────────────────

// A match is considered live (in progress, warrants 30-second refresh) if
// fd.org reports it as active OR FotMob's live flag is set and the match
// isn't marked FINISHED. PAUSED (half-time) is included because the score
// can change when the second half kicks off.
function isMatchLive(status, fotmobData) {
  if (status === "IN_PLAY" || status === "PAUSED") return true;
  if (status === "FINISHED") return false;
  return fotmobData?.live != null;
}

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

// CommonJS export for Jest — not executed in the browser extension context
if (typeof module !== "undefined") {
  module.exports = { isoDate, localIsoDate, formatTime, formatDateLabel, dateKey, EXCLUDED_STATUSES, isVisible, isMatchLive, isKickoffExpired, byDisplayName, groupTeams };
}
