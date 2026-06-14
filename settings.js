// Free-tier competitions available on football-data.org
const COMPETITIONS = [
  // Club competitions — sorted alphabetically
  { code: "BL1", name: "Bundesliga" },
  { code: "ELC", name: "Championship" },
  { code: "CL",  name: "Champions League" },
  { code: "DED", name: "Eredivisie" },
  { code: "PD",  name: "La Liga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "PL",  name: "Premier League" },
  { code: "PPL", name: "Primeira Liga" },
  { code: "SA",  name: "Serie A" },
  // National team competitions — sorted alphabetically
  { code: "EC",  name: "European Championship", national: true },
  { code: "WC",  name: "World Cup",             national: true },
];

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
    showLoading("Fetching matches…");
    load();
  } else if (_lastMatches) {
    renderMatches(_lastMatches); // re-filter with any removals
  }
}

function renderSettingsPanel() {
  const panel = document.getElementById("settings-panel");
  panel.innerHTML = "";
  panel.appendChild(buildTrackedSection());
  panel.appendChild(buildAddSection());
  panel.appendChild(buildNotificationsSection());
  panel.appendChild(buildSupportSection());
}

function buildNotificationsSection() {
  const NOTIFY_OPTIONS = [
    { value: -1, label: "Off" },
    { value:  0, label: "At kickoff" },
    { value:  1, label: "1 minute before" },
    { value:  5, label: "5 minutes before" },
    { value: 10, label: "10 minutes before" },
    { value: 15, label: "15 minutes before" },
    { value: 30, label: "30 minutes before" },
    { value: 60, label: "1 hour before" },
  ];

  const section = document.createElement("div");
  section.className = "settings-section";

  const label = document.createElement("div");
  label.className = "settings-label";
  label.textContent = "Notifications";
  section.appendChild(label);

  const row = document.createElement("div");
  row.className = "settings-notify-row";

  const desc = document.createElement("span");
  desc.className = "settings-notify-label";
  desc.textContent = "Notify me before kickoff";
  row.appendChild(desc);

  const select = document.createElement("select");
  select.className = "settings-select settings-select--inline";
  for (const opt of NOTIFY_OPTIONS) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    select.appendChild(el);
  }

  chrome.storage.local.get("notifyMinutesBefore", (data) => {
    // Default 15 is seeded by onInstalled in background.js; the fallback here
    // is a safety net for the very first run before that write completes.
    select.value = typeof data.notifyMinutesBefore === "number"
      ? data.notifyMinutesBefore
      : 15;
  });

  select.addEventListener("change", () => {
    saveNotifyBefore(Number(select.value));
  });

  row.appendChild(select);
  section.appendChild(row);
  return section;
}

function buildSupportSection() {
  const section = document.createElement("div");
  section.className = "settings-section settings-section--support";

  const btn = document.createElement("button");
  btn.className = "bmc-btn";
  btn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://buymeacoffee.com/borna761" });
  });

  const img = document.createElement("img");
  img.src = "icons/bmc-button.png";
  img.alt = "Buy me a coffee";
  btn.appendChild(img);

  section.appendChild(btn);
  return section;
}

function buildTrackedSection() {
  const section = document.createElement("div");
  section.className = "settings-section";

  const label = document.createElement("div");
  label.className = "settings-label";
  label.textContent = "Tracked teams";
  section.appendChild(label);

  const chips = document.createElement("div");
  chips.className = "tracked-chips";

  if (TEAMS.length === 0) {
    const empty = document.createElement("span");
    empty.className = "settings-empty";
    empty.textContent = "No teams tracked yet";
    chips.appendChild(empty);
  } else {
    [...TEAMS].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).forEach((team) => {
      chips.appendChild(makeChip(team));
    });
  }

  section.appendChild(chips);
  return section;
}

function buildAddSection() {
  const section = document.createElement("div");
  section.className = "settings-section";

  const label = document.createElement("div");
  label.className = "settings-label";
  label.textContent = "Add teams";
  section.appendChild(label);

  const controls = document.createElement("div");
  controls.className = "settings-controls";

  const compSelect = document.createElement("select");
  compSelect.className = "settings-select";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Pick a competition…";
  compSelect.appendChild(placeholder);

  const clubs    = COMPETITIONS.filter((c) => !c.national);
  const national = COMPETITIONS.filter((c) =>  c.national);

  const clubGroup = document.createElement("optgroup");
  clubGroup.label = "Club Competitions";
  for (const comp of clubs) {
    const opt = document.createElement("option");
    opt.value = comp.code;
    opt.textContent = comp.name;
    clubGroup.appendChild(opt);
  }
  compSelect.appendChild(clubGroup);

  const nationalGroup = document.createElement("optgroup");
  nationalGroup.label = "National Teams";
  for (const comp of national) {
    const opt = document.createElement("option");
    opt.value = comp.code;
    opt.textContent = comp.name;
    nationalGroup.appendChild(opt);
  }
  compSelect.appendChild(nationalGroup);

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
  section.appendChild(controls);
  section.appendChild(teamsList);
  return section;
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
  const sorted = [...teams].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
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
        [...TEAMS].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).forEach((t) => {
          chipsEl.appendChild(makeChip(t));
        });
      }
    });

    row.appendChild(btn);
    container.appendChild(row);
  }
}
