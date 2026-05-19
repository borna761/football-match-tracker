// Shared mutable state — read and written by storage.js, api.js, settings.js
let TEAM_IDS = [];
let TEAMS    = [];
let TRACKED_IDS    = new Set();
let enabledTeamIds = new Set();

const EXCLUDED_STATUSES = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

// ── Match cache patching ──────────────────────────────────────────────────────
// Read the raw cache from storage, bypassing the fingerprint check, so we can
// merge or re-sign it after a team change without a full re-fetch.
async function readRawMatchCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get("matchesCache", (data) => resolve(data.matchesCache ?? null));
  });
}

// ── Team management ───────────────────────────────────────────────────────────
async function addTeam(id, knownInfo = null) {
  if (TEAM_IDS.includes(id)) return;

  let info = knownInfo;
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

  // Fetch only this team's matches and merge into the existing cache so we
  // don't need to re-fetch every other team again.
  const existing = await readRawMatchCache();
  if (existing) {
    try {
      const { matches: fresh } = await fetchMatches(info);
      const seen = new Set(existing.matches.map((m) => m.id));
      const merged = [...existing.matches];
      for (const m of fresh) {
        if (!seen.has(m.id)) merged.push(m);
      }
      merged.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
      saveCache(merged); // re-signs with updated fingerprint (new TEAM_IDS)
    } catch {
      // Fetch failed — clear so load() starts fresh on next open
      chrome.storage.local.remove("matchesCache");
    }
  }
  // No existing cache — leave it absent so load() does a full fetch naturally

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

  // No API call needed — re-save the existing cache with the updated
  // fingerprint so it stays valid. filterMatches will exclude the removed
  // team's matches since they're no longer in TRACKED_IDS.
  readRawMatchCache().then((existing) => {
    if (existing) saveCache(existing.matches);
  });

  renderCrests();
}

// ── Match rendering ───────────────────────────────────────────────────────────
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
  const visible  = filterMatches(matches, todayStr, TRACKED_IDS, enabledTeamIds);

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
  const upcoming = visible.filter((m) => localIsoDate(new Date(m.utcDate)) >  todayStr);

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

function setLoadingText(msg) {
  const span = document.querySelector("#loading span");
  if (span) span.textContent = msg;
}

function showLoading(msg = "Loading matches…") {
  const container = document.getElementById("matches-container");
  container.innerHTML = `<div id="loading"><div class="spinner"></div><span>${msg}</span></div>`;
}

function showError(msg) {
  const container = document.getElementById("matches-container");
  container.innerHTML = "";
  const el = document.createElement("div");
  el.id = "error";
  el.textContent = msg;
  container.appendChild(el);
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _liveTimer  = null;
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
      if (matches.length === 0 && TEAMS.length > 0) {
        const container = document.getElementById("matches-container");
        container.innerHTML = "";
        const el = document.createElement("div");
        el.id = "error";
        el.textContent = "Failed to load matches — API may be rate limited. ";
        const retry = document.createElement("a");
        retry.textContent = "Try again";
        retry.addEventListener("click", load);
        el.appendChild(retry);
        container.appendChild(el);
        return;
      }
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
    // Single storage read populates all globals at once
    const { freshTeams, matchCache } = await loadAllState();

    document.getElementById("settings-btn").addEventListener("click", () => {
      if (_settingsOpen) closeSettings();
      else openSettings();
    });

    // Fetch team metadata if cache is missing or stale
    if (freshTeams) {
      TEAMS.push(...freshTeams);
    } else {
      setLoadingText("Fetching team data…");
      const fetched = await fetchAllTeams();
      saveTeams(fetched);
      TEAMS.push(...fetched);
    }
    renderCrests();

    // ── Stale-while-revalidate ──────────────────────────────────────────────
    // If we have cached matches (even stale), render them instantly so the
    // popup feels immediate. Then silently re-fetch in the background if the
    // cache is expired, and update the UI when the fresh data arrives.
    if (matchCache) {
      _lastMatches = matchCache.matches;
      const hasLive = await renderMatches(matchCache.matches);
      if (hasLive) scheduleLiveRefresh(matchCache.matches);

      // Re-fetch in background if stale (don't show spinner)
      if (Date.now() - matchCache.timestamp >= CACHE_TTL_MS) {
        const fresh = await fetchAllMatches();
        if (fresh.length > 0 || TEAMS.length === 0) {
          const cache = saveCache(fresh);
          _lastMatches = cache.matches;
          const stillLive = await renderMatches(cache.matches);
          if (stillLive) scheduleLiveRefresh(cache.matches);
          else clearTimeout(_liveTimer);
        }
      }
    } else {
      setLoadingText("Loading matches…");
      await load();
    }
  });
}
