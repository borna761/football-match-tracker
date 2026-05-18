// API_KEY is loaded from config.js (see config.example.js)
// Pure utility functions are loaded from utils.js

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

// Statuses to exclude entirely from the list
const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

// ── API ──────────────────────────────────────────────────────────────────────
async function fetchMatches(team) {
  const from = new Date();
  from.setDate(from.getDate() - 1);
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

  for (const team of TEAMS) {
    try {
      const { matches, remaining, resetSecs } = await fetchMatches(team);
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
      console.error(`${team.name}:`, err.message);
    }
  }

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

function renderMatch(match, fotmobData) {
  const fotmobUrl = fotmobData?.url ?? fotmobData;
  const { status, score } = match;
  const isLive     = status === "IN_PLAY";
  const isHalfTime = status === "PAUSED";
  const isFinished = status === "FINISHED";

  const row = document.createElement("div");
  row.className = "match-row";
  if (fotmobUrl) {
    row.classList.add("match-row--link");
    row.addEventListener("click", () => chrome.tabs.create({ url: fotmobUrl }));
  }

  const center = document.createElement("div");
  center.className = "match-time";

  if (isFinished) {
    // fullTime is always populated on FINISHED matches
    const ft = score.fullTime;
    const scoreEl = document.createElement("div");
    scoreEl.className = "match-score";
    scoreEl.textContent = `${ft.home ?? "?"} – ${ft.away ?? "?"}`;
    center.appendChild(scoreEl);
  } else if (isHalfTime) {
    // PAUSED = half-time; show HT badge + half-time score
    const badge = document.createElement("div");
    badge.className = "live-badge";
    badge.textContent = "HT";
    center.appendChild(badge);
    const ht = score.halfTime;
    if (ht && ht.home !== null) {
      const scoreEl = document.createElement("div");
      scoreEl.className = "match-score";
      scoreEl.textContent = `${ht.home} – ${ht.away}`;
      center.appendChild(scoreEl);
    }
  } else if (isLive) {
    const liveData = fotmobData?.live;
    if (liveData && liveData.home !== null && liveData.away !== null) {
      const scoreEl = document.createElement("div");
      scoreEl.className = "match-score live";
      scoreEl.textContent = `${liveData.home} – ${liveData.away}`;
      center.appendChild(scoreEl);
      const minuteEl = document.createElement("div");
      minuteEl.className = "live-badge";
      minuteEl.textContent = liveData.minute ?? "LIVE";
      center.appendChild(minuteEl);
    } else {
      const badge = document.createElement("div");
      badge.className = "live-badge";
      badge.textContent = "LIVE";
      center.appendChild(badge);
    }
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

async function renderMatches(matches) {
  const container = document.getElementById("matches-container");
  container.innerHTML = "";

  const todayStr = isoDate(new Date());
  const yesterdayStr = isoDate(new Date(Date.now() - 86400000));

  const visible = matches.filter((m) => {
    if (EXCLUDED_STATUSES.has(m.status)) return false;
    if (m.status !== "FINISHED") return true;
    const d = isoDate(new Date(m.utcDate));
    return d === todayStr || d === yesterdayStr;
  });

  const todayCount = visible.filter((m) => isoDate(new Date(m.utcDate)) === todayStr).length;
  chrome.action.setBadgeText({ text: todayCount > 0 ? String(todayCount) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#f97316" });

  if (visible.length === 0) {
    const el = document.createElement("div");
    el.className = "no-matches";
    el.textContent = "No matches yesterday or in the next 60 days.";
    container.appendChild(el);
    return;
  }

  const uniqueDates = [...new Set(visible.map((m) => isoDate(new Date(m.utcDate))))];
  const fotmobMap = await fetchFotmobUrls(uniqueDates);

  const yesterday = visible.filter((m) => isoDate(new Date(m.utcDate)) === yesterdayStr);
  const today     = visible.filter((m) => isoDate(new Date(m.utcDate)) === todayStr);
  const upcoming  = visible.filter((m) => isoDate(new Date(m.utcDate)) > todayStr);

  function appendSection(label, sectionMatches, { subgroups = false } = {}) {
    if (sectionMatches.length === 0) return null;
    const header = document.createElement("div");
    header.className = "section-header";
    header.textContent = label;
    container.appendChild(header);
    let currentKey = null;
    for (const match of sectionMatches) {
      if (subgroups) {
        const key = dateKey(match.utcDate);
        if (key !== currentKey) {
          currentKey = key;
          const group = document.createElement("div");
          group.className = "date-group";
          const span = document.createElement("span");
          span.className = "date-label";
          span.textContent = formatDateLabel(match.utcDate);
          group.appendChild(span);
          container.appendChild(group);
        }
      }
      container.appendChild(renderMatch(match, getFotmobData(match, fotmobMap)));
    }
    return header;
  }

  appendSection("Yesterday", yesterday);
  const todayHeader   = appendSection("Today", today);
  const upcomingHeader = appendSection("Upcoming", upcoming, { subgroups: true });

  const scrollTarget = todayHeader ?? upcomingHeader;
  if (scrollTarget) {
    requestAnimationFrame(() => scrollTarget.scrollIntoView({ block: "start" }));
  }
}

function renderCrests() {
  const container = document.getElementById("team-crests");
  for (const team of TEAMS) {
    const img = document.createElement("img");
    img.className = "crest-logo";
    img.src = `https://crests.football-data.org/${team.id}.svg`;
    img.alt = team.name;
    img.title = team.name;
    img.onerror = () => img.remove();
    container.appendChild(img);
  }
}

function showError(msg) {
  document.getElementById("matches-container").innerHTML = `<div id="error">${msg}</div>`;
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function load() {
  try {
    let cache = await loadCache();
    if (!cache) {
      const matches = await fetchAllMatches();
      cache = saveCache(matches);
    }
    await renderMatches(cache.matches);
  } catch (err) {
    showError(`Failed to load: ${err.message}`);
  }
}

renderCrests();
document.addEventListener("DOMContentLoaded", () => load());
