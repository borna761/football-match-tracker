// API_KEY is loaded from config.js (see config.example.js)
// Pure utility functions are loaded from utils.js

// Add or remove IDs to change which teams are tracked
const TEAM_IDS = [57, 81, 108, 762, 760, 792];

const CACHE_TTL_MS = 60 * 60 * 1000;
const TEAM_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOOKAHEAD_DAYS = 60;

// Populated from API/cache before first render — treat as read-only after init
let TEAMS = [];

// Statuses to exclude entirely from the list
const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

// ── API ──────────────────────────────────────────────────────────────────────
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

// ── Enabled teams ────────────────────────────────────────────────────────────
const TRACKED_IDS = new Set(TEAM_IDS);
let enabledTeamIds = new Set(TEAM_IDS); // all on by default

function loadEnabledTeams() {
  return new Promise((resolve) => {
    chrome.storage.local.get("enabledTeams", (data) => {
      if (Array.isArray(data.enabledTeams)) {
        enabledTeamIds = new Set(data.enabledTeams.filter((id) => TRACKED_IDS.has(id)));
      }
      resolve();
    });
  });
}

function saveEnabledTeams() {
  chrome.storage.local.set({ enabledTeams: [...enabledTeamIds] });
}

// ── Cache ────────────────────────────────────────────────────────────────────
const TEAMS_FINGERPRINT = TEAM_IDS.join(",");

function loadCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get("matchesCache", (data) => {
      const cache = data.matchesCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== TEAMS_FINGERPRINT) return resolve(null); // teams changed
      resolve(Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null);
    });
  });
}

function saveCache(matches) {
  const cache = { matches, timestamp: Date.now(), fingerprint: TEAMS_FINGERPRINT };
  chrome.storage.local.set({ matchesCache: cache });
  return cache;
}

// ── Team info ────────────────────────────────────────────────────────────────
async function fetchTeamInfo(id) {
  const res = await fetch(`https://api.football-data.org/v4/teams/${id}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const remaining = parseInt(res.headers.get("X-Requests-Available-Minute") ?? "10", 10);
  const resetSecs = parseInt(res.headers.get("X-RequestCounter-Reset") ?? "0", 10);
  if (remaining <= 1 && resetSecs > 0) {
    await new Promise((r) => setTimeout(r, resetSecs * 1000 + 200));
  }
  return {
    id,
    name:      json.name,
    shortName: json.shortName,
    crest:     json.crest,
    national:  json.type === "NATIONAL",
  };
}

function loadTeams() {
  return new Promise((resolve) => {
    chrome.storage.local.get("teamsCache", (data) => {
      const cache = data.teamsCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== TEAMS_FINGERPRINT) return resolve(null);
      if (Date.now() - cache.timestamp > TEAM_INFO_TTL_MS) return resolve(null);
      resolve(cache.teams);
    });
  });
}

function saveTeams(teams) {
  chrome.storage.local.set({
    teamsCache: { teams, timestamp: Date.now(), fingerprint: TEAMS_FINGERPRINT },
  });
}

async function fetchAllTeams() {
  const results = [];
  for (const id of TEAM_IDS) {
    try {
      results.push(await fetchTeamInfo(id));
    } catch (err) {
      console.error(`Team ${id}:`, err.message);
      // Fallback: bare object so the rest of the UI still works
      results.push({ id, name: String(id), shortName: String(id), crest: null, national: false });
    }
  }
  return results;
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
  } else if (isHalfTime || isLive) {
    const liveData = fotmobData?.live;
    if (liveData && liveData.home !== null && liveData.away !== null) {
      // FotMob says the match is in play — show live score + minute
      const scoreEl = document.createElement("div");
      scoreEl.className = "match-score live";
      scoreEl.textContent = `${liveData.home} – ${liveData.away}`;
      center.appendChild(scoreEl);
      const minuteEl = document.createElement("div");
      minuteEl.className = "live-badge";
      minuteEl.textContent = liveData.minute ?? "LIVE";
      center.appendChild(minuteEl);
    } else if (isHalfTime) {
      // FotMob has no live data — show HT badge + half-time score
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
    } else {
      // IN_PLAY but no FotMob data
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

// Pure function — exported for testing
function filterMatches(matches, todayStr, trackedIds, enabledIds) {
  return matches.filter((m) => {
    if (EXCLUDED_STATUSES.has(m.status)) return false;
    if (m.status === "FINISHED") {
      if (localIsoDate(new Date(m.utcDate)) !== todayStr) return false;
    }
    const homeOn = trackedIds.has(m.homeTeam.id) && enabledIds.has(m.homeTeam.id);
    const awayOn = trackedIds.has(m.awayTeam.id) && enabledIds.has(m.awayTeam.id);
    return homeOn || awayOn;
  });
}

if (typeof module !== "undefined") {
  module.exports = { filterMatches };
}

async function renderMatches(matches) {
  const container = document.getElementById("matches-container");
  const isRefresh = container.children.length > 0 && !container.querySelector("#loading");

  const todayStr = localIsoDate(new Date());
  const visible = filterMatches(matches, todayStr, TRACKED_IDS, enabledTeamIds);

  const todayCount = visible.filter((m) => localIsoDate(new Date(m.utcDate)) === todayStr).length;
  chrome.action.setBadgeText({ text: todayCount > 0 ? String(todayCount) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#f97316" });

  // Do all async work before touching the DOM
  const fotmobMap = visible.length > 0
    ? await fetchFotmobUrls([...new Set(visible.map((m) => isoDate(new Date(m.utcDate))))])
    : {};

  // Build new content off-screen in a fragment
  const fragment = document.createDocumentFragment();

  if (visible.length === 0) {
    const el = document.createElement("div");
    el.className = "no-matches";
    el.textContent = "No upcoming matches in the next 60 days.";
    fragment.appendChild(el);
    container.innerHTML = "";
    container.appendChild(fragment);
    return false;
  }

  const today    = visible.filter((m) => localIsoDate(new Date(m.utcDate)) === todayStr);
  const upcoming = visible.filter((m) => localIsoDate(new Date(m.utcDate)) > todayStr);

  function appendSection(label, sectionMatches, { subgroups = false } = {}) {
    if (sectionMatches.length === 0) return null;
    let anchor = null;
    if (label) {
      const header = document.createElement("div");
      header.className = "section-header";
      header.textContent = label;
      fragment.appendChild(header);
      anchor = header;
    }
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
          fragment.appendChild(group);
          if (!anchor) anchor = group;
        }
      }
      fragment.appendChild(renderMatch(match, getFotmobData(match, fotmobMap)));
    }
    return anchor;
  }

  const todayHeader    = appendSection("Today", today);
  const upcomingAnchor = appendSection(null, upcoming, { subgroups: true });

  // Atomic swap — no flash
  container.innerHTML = "";
  container.appendChild(fragment);

  // Only scroll on first render, not on live refreshes
  if (!isRefresh) {
    const scrollTarget = todayHeader ?? upcomingAnchor;
    if (scrollTarget) {
      requestAnimationFrame(() => scrollTarget.scrollIntoView({ block: "start" }));
    }
  }

  return visible.some((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
}

function renderCrests() {
  const container = document.getElementById("team-crests");
  const sorted = [
    ...TEAMS.filter((t) => !t.national).sort((a, b) => a.name.localeCompare(b.name)),
    ...TEAMS.filter((t) =>  t.national).sort((a, b) => a.name.localeCompare(b.name)),
  ];
  let dividedInserted = false;
  for (const team of sorted) {
    if (team.national && !dividedInserted) {
      const div = document.createElement("div");
      div.className = "crest-divider";
      container.appendChild(div);
      dividedInserted = true;
    }
    const img = document.createElement("img");
    img.className = "crest-logo";
    img.src = `https://crests.football-data.org/${team.id}.svg`;
    img.alt = team.name;
    img.title = team.name;
    img.classList.toggle("crest-off", !enabledTeamIds.has(team.id));
    img.onerror = () => img.remove();
    img.addEventListener("click", () => {
      if (enabledTeamIds.has(team.id)) {
        enabledTeamIds.delete(team.id);
      } else {
        enabledTeamIds.add(team.id);
      }
      img.classList.toggle("crest-off", !enabledTeamIds.has(team.id));
      saveEnabledTeams();
      if (_lastMatches) renderMatches(_lastMatches);
    });
    container.appendChild(img);
  }
}

function showError(msg) {
  document.getElementById("matches-container").innerHTML = `<div id="error">${msg}</div>`;
}

// ── Init ─────────────────────────────────────────────────────────────────────
let _liveTimer = null;
let _lastMatches = null;

// Re-render every 30s using cached match data (only re-fetches FotMob live scores)
async function scheduleLiveRefresh(cachedMatches) {
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(async () => {
    try {
      const stillLive = await renderMatches(cachedMatches);
      if (stillLive) scheduleLiveRefresh(cachedMatches);
    } catch { /* silently skip failed live refresh */ }
  }, 30_000);
}

async function load() {
  clearTimeout(_liveTimer);
  try {
    let cache = await loadCache();
    if (!cache) {
      const matches = await fetchAllMatches();
      cache = saveCache(matches);
    }
    _lastMatches = cache.matches;
    const hasLive = await renderMatches(cache.matches);
    if (hasLive) scheduleLiveRefresh(cache.matches);
  } catch (err) {
    showError(`Failed to load: ${err.message}`);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", async () => {
    await loadEnabledTeams();

    // Seed TEAMS with minimal stubs so fetchAllMatches can start immediately
    TEAMS.push(...TEAM_IDS.map((id) => ({ id, name: String(id), shortName: String(id), crest: null, national: false })));

    // Load matches right away — don't block on team metadata
    const matchLoadPromise = load();

    // Fetch team metadata (cached 7 days) in parallel
    let freshTeams = await loadTeams();
    if (!freshTeams) {
      freshTeams = await fetchAllTeams();
      saveTeams(freshTeams);
    }

    // Swap stubs for real data and render crests
    TEAMS.length = 0;
    TEAMS.push(...freshTeams);
    renderCrests();

    await matchLoadPromise;
  });
}
