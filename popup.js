// API_KEY is loaded from config.js (see config.example.js)
// Pure utility functions are loaded from utils.js

// Mutable — loaded from storage, updated when user adds/removes teams
let TEAM_IDS = [];

const CACHE_TTL_MS = 60 * 60 * 1000;
const TEAM_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COMP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOOKAHEAD_DAYS = 60;

// Populated from API/cache before first render — updated when teams change
let TEAMS = [];

// Free-tier competitions on football-data.org
const COMPETITIONS = [
  { code: "PL",  name: "Premier League" },
  { code: "PD",  name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA",  name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
  { code: "CL",  name: "Champions League" },
  { code: "WC",  name: "World Cup" },
  { code: "EC",  name: "European Championship" },
  { code: "ELC", name: "Championship" },
  { code: "DED", name: "Eredivisie" },
  { code: "PPL", name: "Primeira Liga" },
];

// Statuses to exclude entirely from the list
const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

// Cache fingerprints include the manifest version so bumping the version in
// manifest.json automatically invalidates all stored caches.
const APP_VERSION = (typeof chrome !== "undefined" && chrome.runtime)
  ? chrome.runtime.getManifest().version
  : "0";
function teamsFingerprint()   { return `t:${APP_VERSION}:${TEAM_IDS.join(",")}`; }
function matchesFingerprint() { return `m:${APP_VERSION}:${TEAM_IDS.join(",")}`; }

// ── Tracked team IDs (persisted) ─────────────────────────────────────────────
function loadTrackedIds() {
  return new Promise((resolve) => {
    chrome.storage.local.get("trackedTeamIds", (data) => {
      TEAM_IDS = Array.isArray(data.trackedTeamIds) ? data.trackedTeamIds : [];
      resolve();
    });
  });
}

function saveTrackedIds() {
  chrome.storage.local.set({ trackedTeamIds: TEAM_IDS });
}

// ── Enabled teams (toggle state) ─────────────────────────────────────────────
let TRACKED_IDS = new Set();
let enabledTeamIds = new Set();

function loadEnabledTeams() {
  return new Promise((resolve) => {
    chrome.storage.local.get("enabledTeams", (data) => {
      if (Array.isArray(data.enabledTeams)) {
        enabledTeamIds = new Set(data.enabledTeams.filter((id) => TRACKED_IDS.has(id)));
      } else {
        enabledTeamIds = new Set(TEAM_IDS);
      }
      resolve();
    });
  });
}

function saveEnabledTeams() {
  chrome.storage.local.set({ enabledTeams: [...enabledTeamIds] });
}

// ── Match cache ───────────────────────────────────────────────────────────────
function loadCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get("matchesCache", (data) => {
      const cache = data.matchesCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== matchesFingerprint()) return resolve(null);
      resolve(Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null);
    });
  });
}

function saveCache(matches) {
  const cache = { matches, timestamp: Date.now(), fingerprint: matchesFingerprint() };
  chrome.storage.local.set({ matchesCache: cache });
  return cache;
}

// ── Team info cache ───────────────────────────────────────────────────────────
function loadTeams() {
  return new Promise((resolve) => {
    chrome.storage.local.get("teamsCache", (data) => {
      const cache = data.teamsCache;
      if (!cache) return resolve(null);
      if (cache.fingerprint !== teamsFingerprint()) return resolve(null);
      if (Date.now() - cache.timestamp > TEAM_INFO_TTL_MS) return resolve(null);
      resolve(cache.teams);
    });
  });
}

function saveTeams(teams) {
  chrome.storage.local.set({
    teamsCache: { teams, timestamp: Date.now(), fingerprint: teamsFingerprint() },
  });
}

// ── Competition teams cache ───────────────────────────────────────────────────
function loadCompCache(code) {
  return new Promise((resolve) => {
    chrome.storage.local.get(`compTeams_${code}`, (data) => {
      const cache = data[`compTeams_${code}`];
      if (!cache) return resolve(null);
      if (Date.now() - cache.timestamp > COMP_CACHE_TTL_MS) return resolve(null);
      resolve(cache.teams);
    });
  });
}

function saveCompCache(code, teams) {
  chrome.storage.local.set({ [`compTeams_${code}`]: { teams, timestamp: Date.now() } });
}

// ── API ───────────────────────────────────────────────────────────────────────
async function fetchMatches(team) {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + LOOKAHEAD_DAYS);
  // Use local date for dateFrom so matches from today aren't missed when
  // the local clock is still on "today" but UTC has already rolled over.
  const url = `https://api.football-data.org/v4/teams/${team.id}/matches?dateFrom=${localIsoDate(from)}&dateTo=${isoDate(to)}`;
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

// Competition codes that indicate a national (not club) team
const NATIONAL_COMP_CODES = new Set(["WC", "EC"]);

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
  // The API has no top-level "type" field on teams — derive national status
  // from runningCompetitions instead (WC/EC = national team, everything else = club).
  const national = (json.runningCompetitions || []).some((c) => NATIONAL_COMP_CODES.has(c.code));
  return {
    id,
    name:      json.name,
    shortName: json.shortName,
    crest:     json.crest,
    national,
  };
}

async function fetchAllTeams() {
  const results = [];
  for (const id of TEAM_IDS) {
    try {
      results.push(await fetchTeamInfo(id));
    } catch (err) {
      console.error(`Team ${id}:`, err.message);
      results.push({ id, name: String(id), shortName: String(id), crest: null, national: false });
    }
  }
  return results;
}

async function fetchCompTeams(code) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // Derive national status from the competition code rather than t.type,
  // because the API does not reliably set a top-level type field on team objects.
  const isNational = NATIONAL_COMP_CODES.has(code);
  return (json.teams || []).map((t) => ({
    id:        t.id,
    name:      t.name,
    shortName: t.shortName,
    crest:     t.crest,
    national:  isNational,
  }));
}

// ── Team management ───────────────────────────────────────────────────────────
async function addTeam(id, knownInfo = null) {
  if (TEAM_IDS.includes(id)) return;

  let info = knownInfo ?? null;
  if (!info) {
    try {
      info = await fetchTeamInfo(id);
    } catch {
      info = { id, name: String(id), shortName: String(id), crest: null, national: false };
    }
  }

  TEAM_IDS.push(id);
  TRACKED_IDS.add(id);
  enabledTeamIds.add(id);
  TEAMS.push(info);

  saveTrackedIds();
  saveEnabledTeams();
  saveTeams(TEAMS);
  chrome.storage.local.remove("matchesCache");
  renderCrests();
}

function removeTeam(id) {
  TEAM_IDS = TEAM_IDS.filter((x) => x !== id);
  TRACKED_IDS.delete(id);
  enabledTeamIds.delete(id);
  const idx = TEAMS.findIndex((t) => t.id === id);
  if (idx !== -1) TEAMS.splice(idx, 1);

  saveTrackedIds();
  saveEnabledTeams();
  saveTeams(TEAMS);
  chrome.storage.local.remove("matchesCache");
  renderCrests();
}

// ── Rendering — match list ────────────────────────────────────────────────────
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
    const ft = score.fullTime;
    const scoreEl = document.createElement("div");
    scoreEl.className = "match-score";
    scoreEl.textContent = `${ft.home ?? "?"} – ${ft.away ?? "?"}`;
    center.appendChild(scoreEl);
  } else if (isHalfTime || isLive) {
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
    } else if (isHalfTime) {
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

  const fotmobMap = visible.length > 0
    ? await fetchFotmobUrls([...new Set(visible.map((m) => isoDate(new Date(m.utcDate))))])
    : {};

  const fragment = document.createDocumentFragment();

  if (visible.length === 0) {
    const el = document.createElement("div");
    el.className = "no-matches";
    el.textContent = TEAM_IDS.length === 0
      ? "No teams tracked. Use the ⚙ settings to add teams."
      : "No upcoming matches in the next 60 days.";
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

  container.innerHTML = "";
  container.appendChild(fragment);

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
  container.innerHTML = "";
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
      if (_lastMatches && !_settingsOpen) renderMatches(_lastMatches);
    });
    container.appendChild(img);
  }
}

function showError(msg) {
  document.getElementById("matches-container").innerHTML = `<div id="error">${msg}</div>`;
}

// ── Settings panel ────────────────────────────────────────────────────────────
let _settingsOpen = false;
let _teamAddedInSettings = false;
let _compTeams = [];

function openSettings() {
  _settingsOpen = true;
  _teamAddedInSettings = false;
  document.getElementById("matches-container").hidden = true;
  document.getElementById("settings-panel").hidden = false;
  document.getElementById("settings-btn").classList.add("active");
  renderSettingsPanel();
}

function closeSettings() {
  _settingsOpen = false;
  document.getElementById("settings-panel").hidden = true;
  document.getElementById("matches-container").hidden = false;
  document.getElementById("settings-btn").classList.remove("active");

  if (_teamAddedInSettings) {
    load(); // full reload to fetch matches for new teams
  } else if (_lastMatches) {
    renderMatches(_lastMatches); // re-filter with any removals
  }
}

function renderSettingsPanel() {
  const panel = document.getElementById("settings-panel");
  panel.innerHTML = "";

  // ── Tracked teams ──
  const trackedSection = document.createElement("div");
  trackedSection.className = "settings-section";

  const trackedLabel = document.createElement("div");
  trackedLabel.className = "settings-label";
  trackedLabel.textContent = "Tracked teams";
  trackedSection.appendChild(trackedLabel);

  const chips = document.createElement("div");
  chips.className = "tracked-chips";

  if (TEAMS.length === 0) {
    const empty = document.createElement("span");
    empty.className = "settings-empty";
    empty.textContent = "No teams tracked yet";
    chips.appendChild(empty);
  } else {
    const sorted = [...TEAMS].sort((a, b) => a.name.localeCompare(b.name));
    for (const team of sorted) {
      chips.appendChild(makeChip(team));
    }
  }

  trackedSection.appendChild(chips);
  panel.appendChild(trackedSection);

  // ── Add teams ──
  const addSection = document.createElement("div");
  addSection.className = "settings-section";

  const addLabel = document.createElement("div");
  addLabel.className = "settings-label";
  addLabel.textContent = "Add teams";
  addSection.appendChild(addLabel);

  const controls = document.createElement("div");
  controls.className = "settings-controls";

  const compSelect = document.createElement("select");
  compSelect.className = "settings-select";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Pick a competition…";
  compSelect.appendChild(placeholder);
  for (const comp of COMPETITIONS) {
    const opt = document.createElement("option");
    opt.value = comp.code;
    opt.textContent = comp.name;
    compSelect.appendChild(opt);
  }

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "settings-search";
  searchInput.placeholder = "Search teams…";
  searchInput.disabled = true;

  const teamsList = document.createElement("div");
  teamsList.className = "comp-teams-list";

  compSelect.addEventListener("change", async () => {
    const code = compSelect.value;
    if (!code) {
      searchInput.disabled = true;
      searchInput.value = "";
      _compTeams = [];
      teamsList.innerHTML = "";
      return;
    }
    searchInput.disabled = false;
    teamsList.innerHTML = `<div class="settings-status">Loading…</div>`;

    let teams = await loadCompCache(code);
    if (!teams) {
      try {
        teams = await fetchCompTeams(code);
        saveCompCache(code, teams);
      } catch (err) {
        teamsList.innerHTML = `<div class="settings-status">Failed to load: ${err.message}</div>`;
        return;
      }
    }
    _compTeams = teams;
    renderCompTeamRows(teamsList, filterCompTeams(searchInput.value));
  });

  searchInput.addEventListener("input", () => {
    renderCompTeamRows(teamsList, filterCompTeams(searchInput.value));
  });

  controls.appendChild(compSelect);
  controls.appendChild(searchInput);
  addSection.appendChild(controls);
  addSection.appendChild(teamsList);
  panel.appendChild(addSection);
}

function makeChip(team) {
  const chip = document.createElement("div");
  chip.className = "team-chip";

  const crest = document.createElement("img");
  crest.className = "team-chip-crest";
  crest.src = `https://crests.football-data.org/${team.id}.svg`;
  crest.alt = "";
  crest.onerror = () => crest.remove();
  chip.appendChild(crest);

  const name = document.createElement("span");
  name.textContent = team.shortName || team.name;
  chip.appendChild(name);

  const btn = document.createElement("button");
  btn.className = "team-chip-remove";
  btn.textContent = "×";
  btn.title = `Remove ${team.name}`;
  btn.addEventListener("click", () => {
    removeTeam(team.id);
    renderSettingsPanel();
  });
  chip.appendChild(btn);

  return chip;
}

function filterCompTeams(query) {
  const q = query.trim().toLowerCase();
  if (!q) return _compTeams;
  return _compTeams.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.shortName || "").toLowerCase().includes(q)
  );
}

function renderCompTeamRows(container, teams) {
  container.innerHTML = "";
  if (teams.length === 0) {
    container.innerHTML = `<div class="settings-status">No teams found.</div>`;
    return;
  }
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  for (const team of sorted) {
    const isTracked = TEAM_IDS.includes(team.id);
    const row = document.createElement("div");
    row.className = "comp-team-row";

    const crest = document.createElement("img");
    crest.className = "comp-team-crest";
    crest.src = team.crest || `https://crests.football-data.org/${team.id}.svg`;
    crest.alt = "";
    crest.onerror = () => { crest.style.visibility = "hidden"; };
    row.appendChild(crest);

    const nameEl = document.createElement("span");
    nameEl.className = "comp-team-name";
    nameEl.textContent = team.shortName || team.name;
    row.appendChild(nameEl);

    const btn = document.createElement("button");
    btn.className = `comp-team-btn${isTracked ? " tracked" : ""}`;
    btn.textContent = isTracked ? "Added" : "Add";
    if (isTracked) btn.disabled = true;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Adding…";
      await addTeam(team.id, team);
      _teamAddedInSettings = true;
      btn.className = "comp-team-btn tracked";
      btn.textContent = "Added";
      // Refresh the chips section
      const chipsEl = document.querySelector(".tracked-chips");
      if (chipsEl) {
        chipsEl.innerHTML = "";
        const sorted2 = [...TEAMS].sort((a, b) => a.name.localeCompare(b.name));
        for (const t of sorted2) chipsEl.appendChild(makeChip(t));
      }
    });

    row.appendChild(btn);
    container.appendChild(row);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _liveTimer = null;
let _lastMatches = null;

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
    await loadTrackedIds();
    TRACKED_IDS = new Set(TEAM_IDS);
    await loadEnabledTeams();

    // Wire up settings toggle
    document.getElementById("settings-btn").addEventListener("click", () => {
      if (_settingsOpen) closeSettings();
      else openSettings();
    });

    // Load team metadata first, then matches — sequential so both don't
    // compete for the 10 req/min rate limit on a cold cache.
    let freshTeams = await loadTeams();
    if (!freshTeams) {
      freshTeams = await fetchAllTeams();
      saveTeams(freshTeams);
    }
    TEAMS.push(...freshTeams);
    renderCrests();

    await load();
  });
}
