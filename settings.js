// Free-tier competitions available on football-data.org
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
  panel.appendChild(buildTrackedSection());
  panel.appendChild(buildAddSection());
  panel.appendChild(buildSupportSection());
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
    [...TEAMS].sort((a, b) => a.name.localeCompare(b.name)).forEach((team) => {
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
        [...TEAMS].sort((a, b) => a.name.localeCompare(b.name)).forEach((t) => {
          chipsEl.appendChild(makeChip(t));
        });
      }
    });

    row.appendChild(btn);
    container.appendChild(row);
  }
}
