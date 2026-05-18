// API_KEY is loaded from config.js (see config.example.js)

// IDs from football-data.org — Inter Miami not available on free tier
const TEAMS = [
  { id: 57,  name: "Arsenal" },
  { id: 81,  name: "Barcelona" },
  { id: 108, name: "Inter Milan" },
  { id: 762, name: "Argentina" },
  { id: 760, name: "Spain" },
  { id: 763, name: "Sweden" },
];

const CACHE_TTL_MS = 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 60;

// ── API ──────────────────────────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().slice(0, 10); }

async function fetchMatches(team) {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + LOOKAHEAD_DAYS);
  const url = `https://api.football-data.org/v4/teams/${team.id}/matches?dateFrom=${isoDate(from)}&dateTo=${isoDate(to)}`;
  const res = await fetch(url, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errorCode) throw new Error(json.message);
  const remaining = parseInt(res.headers.get("X-Requests-Available-Minute") ?? "10", 10);
  const resetSecs = parseInt(res.headers.get("X-RequestCounter-Reset") ?? "0", 10);
  return { matches: json.matches || [], remaining, resetSecs };
}

async function fetchAllMatches() {
  const allMatches = [];
  const seen = new Set();
  const debugLines = [];

  for (const team of TEAMS) {
    try {
      const { matches, remaining, resetSecs } = await fetchMatches(team);
      debugLines.push(`${team.name}: ${matches.length} match(es)`);
      for (const match of matches) {
        if (!seen.has(match.id)) {
          seen.add(match.id);
          allMatches.push(match);
        }
      }
      if (remaining <= 1 && resetSecs > 0) {
        await new Promise((r) => setTimeout(r, resetSecs * 1000 + 200));
      }
    } catch (err) {
      debugLines.push(`${team.name}: ERR — ${err.message}`);
    }
  }

  const existing = document.getElementById("debug-output");
  if (existing) existing.remove();
  const dbg = document.createElement("pre");
  dbg.id = "debug-output";
  dbg.style.cssText = "font-size:10px;color:#64748b;padding:8px 16px;white-space:pre-wrap;border-top:1px solid rgba(255,255,255,0.05)";
  dbg.textContent = debugLines.join("\n");
  document.getElementById("app").appendChild(dbg);

  allMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  return allMatches;
}

// ── Cache ────────────────────────────────────────────────────────────────────
function loadCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get("matchesCache", (data) => {
      const cache = data.matchesCache;
      resolve(cache && Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null);
    });
  });
}

function saveCache(matches) {
  const cache = { matches, timestamp: Date.now() };
  chrome.storage.local.set({ matchesCache: cache });
  return cache;
}

// ── Rendering ────────────────────────────────────────────────────────────────
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

function dateKey(dateStr) { return new Date(dateStr).toDateString(); }

function logoEl(team) {
  if (!team.crest) {
    const div = document.createElement("div");
    div.className = "team-logo-placeholder";
    return div;
  }
  const img = document.createElement("img");
  img.className = "team-logo";
  img.src = team.crest;
  img.alt = team.name;
  img.onerror = () => {
    const div = document.createElement("div");
    div.className = "team-logo-placeholder";
    img.replaceWith(div);
  };
  return img;
}

function teamEl(team, side) {
  const el = document.createElement("div");
  el.className = `team ${side}`;
  el.appendChild(logoEl(team));
  const name = document.createElement("span");
  name.className = "team-name";
  name.textContent = team.shortName || team.name;
  el.appendChild(name);
  return el;
}

function renderMatch(match) {
  const isLive = ["IN_PLAY", "PAUSED"].includes(match.status);
  const isFinished = match.status === "FINISHED";

  const row = document.createElement("div");
  row.className = "match-row";

  const center = document.createElement("div");
  center.className = "match-time";

  if (isLive || isFinished) {
    const score = document.createElement("div");
    score.className = isLive ? "match-score live" : "match-score";
    const h = match.score.fullTime.home ?? "?";
    const a = match.score.fullTime.away ?? "?";
    score.textContent = `${h} – ${a}`;
    center.appendChild(score);
  } else {
    const time = document.createElement("div");
    time.className = "match-time-value";
    time.textContent = formatTime(match.utcDate);
    center.appendChild(time);
  }

  const league = document.createElement("div");
  league.className = "match-league";
  league.textContent = match.competition.name;
  center.appendChild(league);

  row.appendChild(teamEl(match.homeTeam, "home"));
  row.appendChild(center);
  row.appendChild(teamEl(match.awayTeam, "away"));
  return row;
}

function renderMatches(matches) {
  const container = document.getElementById("matches-container");
  container.innerHTML = "";

  const upcoming = matches.filter((m) => m.status !== "FINISHED" || isToday(m.utcDate));

  if (upcoming.length === 0) {
    const el = document.createElement("div");
    el.className = "no-matches";
    el.textContent = "No upcoming matches in the next 60 days.";
    container.appendChild(el);
    return;
  }

  let currentKey = null;
  for (const match of upcoming) {
    const key = dateKey(match.utcDate);
    if (key !== currentKey) {
      currentKey = key;
      const group = document.createElement("div");
      group.className = "date-group";
      const label = document.createElement("span");
      label.className = "date-label";
      label.textContent = formatDateLabel(match.utcDate);
      group.appendChild(label);
      container.appendChild(group);
    }
    container.appendChild(renderMatch(match));
  }
}

function isToday(dateStr) {
  return new Date(dateStr).toDateString() === new Date().toDateString();
}

function setLastUpdated(timestamp) {
  document.getElementById("last-updated").textContent =
    `Updated ${new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function showError(msg) {
  document.getElementById("matches-container").innerHTML = `<div id="error">${msg}</div>`;
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function load(forceRefresh = false) {
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("spinning");

  try {
    let cache = forceRefresh ? null : await loadCache();
    if (!cache) {
      const matches = await fetchAllMatches();
      cache = saveCache(matches);
    }
    renderMatches(cache.matches);
    setLastUpdated(cache.timestamp);
  } catch (err) {
    showError(`Failed to load: ${err.message}`);
  } finally {
    btn.classList.remove("spinning");
  }
}

document.getElementById("refresh-btn").addEventListener("click", () => load(true));
document.addEventListener("DOMContentLoaded", () => load());
