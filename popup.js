// Shared mutable state — read and written by storage.js, api.js, settings.js
let TEAM_IDS = [];
let TEAMS    = [];
let TRACKED_IDS    = new Set();
let enabledTeamIds = new Set();

// EXCLUDED_STATUSES and isVisible come from utils.js (loaded before this file).

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

  // We need the team's competition list to fetch its matches. Settings passes
  // knownInfo from the competition browser, which lacks it, so fetch full team
  // info whenever competitions are missing.
  let info = knownInfo;
  if (!info || !info.competitions) {
    try {
      info = await fetchTeamInfo(id);
    } catch {
      info = { id, name: String(id), shortName: String(id), crest: null, national: false, competitions: [] };
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
  // don't need to re-fetch every other team again. Skip when the team's
  // competition is unknown (fetchTeamInfo failed) — fetchAllMatches would then
  // sweep all 11 competitions just for this one add; let the next full refresh
  // pick it up instead.
  const existing = await readRawMatchCache();
  if (existing && info.competitions && info.competitions.length) {
    try {
      const fresh = await fetchAllMatches([info]);
      const seen = new Set(existing.matches.map((m) => m.id));
      const merged = [...existing.matches];
      for (const m of fresh) {
        if (!seen.has(m.id)) merged.push(m);
      }
      merged.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
      saveCache(merged, TEAM_IDS); // re-signs with updated fingerprint (new TEAM_IDS)
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
    if (existing) saveCache(existing.matches, TEAM_IDS);
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
  const isFinished = status === "FINISHED";
  // Trust FotMob's live flag when the fd.org cache is stale — the match may
  // have kicked off while the cached status is still TIMED/SCHEDULED.
  // Guard against FINISHED so a briefly-stale FotMob entry doesn't keep
  // scheduleLiveRefresh running after the match ends.
  const isLive     = status === "IN_PLAY" || (!isFinished && fotmobData?.live != null);
  const isHalfTime = status === "PAUSED";

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

// Pure function — exported for testing. Extends the shared isVisible() check
// with a popup-only rule: finished matches only show on the day they were played.
function filterMatches(matches, todayStr, trackedIds, enabledIds) {
  return matches.filter((m) => {
    if (!isVisible(m, trackedIds, enabledIds)) return false;
    if (m.status === "FINISHED" && localIsoDate(new Date(m.utcDate)) !== todayStr) return false;
    return true;
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

  const todayCount = visible.filter((m) => {
    if (localIsoDate(new Date(m.utcDate)) !== todayStr) return false;
    if (m.status === "FINISHED") return false;
    if (Date.now() - new Date(m.utcDate).getTime() > 120 * 60 * 1000) return false;
    return true;
  }).length;
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

  let anyLive = false;

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
      const fData = getFotmobData(match, fotmobMap);
      const s = match.status;
      if (s === "IN_PLAY" || s === "PAUSED" || (s !== "FINISHED" && fData?.live != null)) {
        anyLive = true;
      }
      fragment.appendChild(renderMatch(match, fData));
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

  return anyLive;
}

function renderCrests() {
  const container = document.getElementById("team-crests");
  container.innerHTML = "";
  const { clubs, national } = groupTeams(TEAMS);
  const sorted = [...clubs, ...national];
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

// Update team records (names, crests, competitions) from fetched match data and
// re-render the crest bar. Lets clubs whose /v4/teams/{id} endpoint is 403'd
// still show a real name once their matches load.
function healTeams(matches) {
  const healed = teamsFromMatches(TEAMS, matches);
  // Skip the storage write and crest re-render when nothing actually changed —
  // healTeams runs on every popup open, usually with already-current records.
  if (JSON.stringify(healed) === JSON.stringify(TEAMS)) return;
  TEAMS.splice(0, TEAMS.length, ...healed);
  saveTeams(TEAMS);
  renderCrests();
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

async function scheduleLiveRefresh() {
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(async () => {
    try {
      // Suppress error UI on live-refresh ticks — a transient failure should
      // keep the existing match display intact, not replace it with an error.
      // load() rethrows when suppressError is true so we can re-arm below.
      await load(true);
    } catch {
      scheduleLiveRefresh(); // re-arm even on failure so the loop survives blips
    }
  }, 30_000);
}

async function load(suppressError = false) {
  clearTimeout(_liveTimer);
  try {
    let cache = await loadCache(TEAM_IDS);
    if (!cache) {
      const matches = await fetchAllMatches(TEAMS);
      if (matches.length === 0 && TEAMS.length > 0) {
        // No matches: either genuinely none in the window (off-season) or a
        // transient fetch failure. Show the normal "No upcoming matches" empty
        // state and don't cache it, so the next open re-checks.
        _lastMatches = [];
        await renderMatches([]);
        return;
      }
      cache = saveCache(matches, TEAM_IDS);
      healTeams(matches);
    }
    _lastMatches = cache.matches;
    const hasLive = await renderMatches(cache.matches);
    if (hasLive) scheduleLiveRefresh();
  } catch (err) {
    if (!suppressError) showError(`Failed to load: ${err.message}`);
    throw err;
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

    // Durable team records (bare id placeholders for any we haven't seen yet).
    // We never call /v4/teams/{id} — it 403s for clubs in restricted
    // competitions; names/competitions are healed from match data below.
    TEAMS.push(...freshTeams);
    renderCrests();

    // ── Stale-while-revalidate ──────────────────────────────────────────────
    // If we have cached matches (even stale), render them instantly so the
    // popup feels immediate. Then silently re-fetch in the background if the
    // cache is expired, and update the UI when the fresh data arrives.
    if (matchCache) {
      healTeams(matchCache.matches); // fill in any placeholder names from cached data
      _lastMatches = matchCache.matches;
      const hasLive = await renderMatches(matchCache.matches);
      if (hasLive) scheduleLiveRefresh();

      // Re-fetch in background if stale (don't show spinner)
      if (Date.now() - matchCache.timestamp >= CACHE_TTL_MS) {
        const fresh = await fetchAllMatches(TEAMS);
        if (fresh.length > 0 || TEAMS.length === 0) {
          const cache = saveCache(fresh, TEAM_IDS);
          healTeams(fresh);
          _lastMatches = cache.matches;
          const stillLive = await renderMatches(cache.matches);
          if (stillLive) scheduleLiveRefresh();
          else clearTimeout(_liveTimer);
        }
      }
    } else {
      setLoadingText("Loading matches…");
      await load();
    }
  });
}
