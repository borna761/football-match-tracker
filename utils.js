function isoDate(d) {
  return d.toISOString().slice(0, 10);
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

// CommonJS export for Jest — not executed in the browser extension context
if (typeof module !== "undefined") {
  module.exports = { isoDate, formatTime, formatDateLabel, dateKey };
}
