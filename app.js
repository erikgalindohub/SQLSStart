const STORAGE_KEY = "epicJoinMapperJsonDb";
const THEME_KEY = "epicJoinMapperTheme";
const STARTER_JSON_URL = "data/starter-metadata.json";

let db = {
  tables: {},
  joinRules: [],
  sourceTables: [],
  importedFile: "",
  extractedAt: ""
};

let expandedJoinRows = new Set();
let expandedDescriptionRows = new Set();
let resizeState = null;
const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  applySavedTheme();
  loadDb();

  if (hasData()) {
    renderAll();
  } else {
    loadStarterJson();
  }
});

function cacheElements() {
  [
    "jsonFile",
    "themeToggle",
    "clearFilters",
    "filterRow",
    "tableFilter",
    "columnFilter",
    "descriptionFilter",
    "status",
    "dataSource",
    "metadataRows"
  ]
    .forEach(id => els[id] = document.getElementById(id));
  els.metadataTable = document.querySelector(".metadata-table");
}

function bindEvents() {
  els.jsonFile.addEventListener("change", importJsonFile);
  els.themeToggle.addEventListener("click", toggleTheme);
  els.clearFilters.addEventListener("click", clearFilters);
  [els.tableFilter, els.columnFilter, els.descriptionFilter]
    .forEach(input => input.addEventListener("input", renderRows));
  els.metadataRows.addEventListener("click", handleMetadataClick);
  document.querySelectorAll(".resize-handle")
    .forEach(handle => handle.addEventListener("mousedown", startColumnResize));
  document.addEventListener("mousemove", resizeColumn);
  document.addEventListener("mouseup", stopColumnResize);
}

function applySavedTheme() {
  setTheme(localStorage.getItem(THEME_KEY) || "light");
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const isDark = theme === "dark";
  els.themeToggle.textContent = isDark ? "Light" : "Dark";
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function loadDb() {
  localStorage.removeItem("epicJoinMapperDb");
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    db = {
      tables: parsed.tables || {},
      joinRules: parsed.joinRules || [],
      sourceTables: parsed.sourceTables || [],
      importedFile: parsed.importedFile || "",
      extractedAt: parsed.extractedAt || ""
    };
  } catch {
    setStatus("Saved JSON metadata could not be loaded.", true);
  }
}

function hasData() {
  return Object.keys(db.tables || {}).length > 0;
}

function loadStarterJson() {
  fetch(STARTER_JSON_URL)
    .then(response => {
      if (!response.ok) throw new Error("starter JSON not found");
      return response.json();
    })
    .then(data => {
      db = convertMetadataJson(data, STARTER_JSON_URL);
      expandedJoinRows.clear();
      expandedDescriptionRows.clear();
      saveDb();
      renderAll();
      setStatus("Loaded starter JSON.");
    })
    .catch(() => {
      renderAll();
      setStatus("Add a metadata JSON file to begin.");
    });
}

function importJsonFile() {
  const files = [...(els.jsonFile.files || [])];
  if (!files.length) return;

  Promise.all(files.map(readJsonFile))
    .then(results => {
      const uploadedDb = mergeMetadataDbs(results.map(result => convertMetadataJson(result.data, result.name)));
      db = mergeMetadataDbs([db, uploadedDb]);
      expandedJoinRows.clear();
      expandedDescriptionRows.clear();
      saveDb();
      renderAll();
      setStatus(`Merged ${files.length} JSON file${files.length === 1 ? "" : "s"}.`);
    })
    .catch(error => setStatus(`Could not load JSON: ${error.message}`, true));
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve({ name: file.name, data: JSON.parse(reader.result) });
      } catch (error) {
        reject(new Error(`${file.name}: ${error.message}`));
      }
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

function convertMetadataJson(input, fileName) {
  if (!input || !Array.isArray(input.tables)) {
    throw new Error("Expected JSON with a tables array.");
  }

  const next = {
    tables: {},
    joinRules: [],
    sourceTables: [],
    importedFile: fileName,
    extractedAt: input.extractedAt || ""
  };

  input.tables.forEach(tableDef => {
    const tableName = normalize(tableDef.table || tableDef.name).toUpperCase();
    if (!tableName) return;

    next.sourceTables.push(tableName);
    next.tables[tableName] = {
      name: tableName,
      description: tableDef.description || "",
      primaryKey: (tableDef.primaryKey || []).map(value => normalize(value).toUpperCase()),
      columns: {}
    };

    (tableDef.columns || []).forEach(columnDef => {
      const columnName = normalize(columnDef.name).toUpperCase();
      if (!columnName) return;

      next.tables[tableName].columns[columnName] = {
        tableName,
        name: columnName,
        description: columnDef.description || "",
        ini: columnDef.ini || "",
        item: columnDef.item || "",
        isPrimaryKey: next.tables[tableName].primaryKey.includes(columnName),
        isForeignKey: Array.isArray(columnDef.joins) && columnDef.joins.length > 0
      };

      (columnDef.joins || []).forEach(join => {
        addJoinRule(next, tableName, columnName, join.targetTable, join.targetColumn);
      });
    });
  });

  (input.foreignKeys || []).forEach(join => {
    addJoinRule(next, join.sourceTable, join.sourceColumn, join.targetTable, join.targetColumn);
  });

  next.sourceTables = [...new Set(next.sourceTables)].sort();
  next.joinRules = dedupeJoinRules(next.joinRules);
  return next;
}

function addJoinRule(targetDb, sourceTable, sourceColumn, targetTable, targetColumn) {
  const fromTable = normalize(sourceTable).toUpperCase();
  const fromColumn = normalize(sourceColumn).toUpperCase();
  const toTable = normalize(targetTable).toUpperCase();
  const toColumn = normalize(targetColumn).toUpperCase();
  if (!fromTable || !fromColumn || !toTable || !toColumn) return;

  if (!targetDb.tables[fromTable]) {
    targetDb.tables[fromTable] = { name: fromTable, columns: {} };
  }
  if (!targetDb.tables[toTable]) {
    targetDb.tables[toTable] = { name: toTable, columns: {} };
  }
  if (!targetDb.tables[fromTable].columns[fromColumn]) {
    targetDb.tables[fromTable].columns[fromColumn] = {
      tableName: fromTable,
      name: fromColumn,
      description: "",
      isPrimaryKey: false,
      isForeignKey: true
    };
  }
  targetDb.tables[fromTable].columns[fromColumn].isForeignKey = true;

  targetDb.joinRules.push({
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    source: "metadata JSON",
    verified: true
  });
}

function mergeMetadataDbs(dbs) {
  const importedFiles = [];
  const extractedAts = [];
  const merged = {
    tables: {},
    joinRules: [],
    sourceTables: [],
    importedFile: "",
    extractedAt: ""
  };

  dbs.forEach(item => {
    const itemSourceTables = new Set(item.sourceTables || []);
    Object.entries(item.tables || {}).forEach(([tableName, table]) => {
      const incomingIsSource = itemSourceTables.has(tableName);
      const existingIsSource = merged.sourceTables.includes(tableName);
      if (!merged.tables[tableName] || incomingIsSource || !existingIsSource) {
        merged.tables[tableName] = table;
      }
    });
    merged.joinRules.push(...(item.joinRules || []));
    merged.sourceTables.push(...(item.sourceTables || []));
    splitListValue(item.importedFile).forEach(value => importedFiles.push(value));
    splitListValue(item.extractedAt).forEach(value => extractedAts.push(value));
  });

  merged.sourceTables = [...new Set(merged.sourceTables)].sort();
  merged.joinRules = dedupeJoinRules(merged.joinRules);
  merged.importedFile = [...new Set(importedFiles)].join(", ");
  merged.extractedAt = [...new Set(extractedAts)].join(", ");
  return merged;
}

function dedupeJoinRules(rules) {
  const seen = new Set();
  return rules.filter(rule => {
    const key = `${rule.fromTable}.${rule.fromColumn}->${rule.toTable}.${rule.toColumn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderAll() {
  renderDataSource();
  renderRows();
}

function renderDataSource() {
  if (!db.importedFile) {
    els.dataSource.textContent = "No JSON loaded.";
    return;
  }

  els.dataSource.textContent = `Loaded: ${db.importedFile}`;
}

function renderRows() {
  const tableFilter = els.tableFilter.value.trim().toUpperCase();
  const columnFilter = els.columnFilter.value.trim().toUpperCase();
  const descriptionFilter = els.descriptionFilter.value.trim().toUpperCase();
  const rows = buildRows();
  const filtered = rows.filter(row => {
    if (tableFilter && !row.table.includes(tableFilter)) return false;
    if (columnFilter && !row.column.includes(columnFilter)) return false;
    if (descriptionFilter && !row.description.toUpperCase().includes(descriptionFilter)) return false;
    return true;
  });

  els.metadataRows.innerHTML = filtered.map(renderRow).join("");
  updateDescriptionOverflow();

  if (!filtered.length) {
    els.metadataRows.innerHTML = `
      <tr>
        <td colspan="4" class="empty-cell">No matching metadata.</td>
      </tr>
    `;
  }
}

function handleMetadataClick(event) {
  const button = event.target.closest("[data-action='toggle-joins']");
  if (button) {
    const rowKey = button.dataset.rowKey;
    if (expandedJoinRows.has(rowKey)) {
      expandedJoinRows.delete(rowKey);
    } else {
      expandedJoinRows.add(rowKey);
    }
    renderRows();
    return;
  }

  const description = event.target.closest("[data-action='toggle-description']");
  if (description) {
    if (description.dataset.expandable !== "true") return;
    const rowKey = description.dataset.rowKey;
    if (expandedDescriptionRows.has(rowKey)) {
      expandedDescriptionRows.delete(rowKey);
    } else {
      expandedDescriptionRows.add(rowKey);
    }
    renderRows();
  }
}

function buildRows() {
  return (db.sourceTables || [])
    .filter(tableName => db.tables[tableName])
    .flatMap(tableName => {
      const table = db.tables[tableName];
      return Object.values(table.columns || {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(column => {
          const joins = getJoins(tableName, column.name);
          const joinText = joins.map(join => `${join.toTable}.${join.toColumn}`).join("; ");
          return {
            table: tableName,
            column: column.name,
            description: column.description || "",
            joins,
            joinText,
            rowKey: `${tableName}.${column.name}`,
            searchText: [
              tableName,
              column.name,
              column.description || "",
              joinText
            ].join(" ").toUpperCase()
          };
        });
    });
}

function getJoins(tableName, columnName) {
  return db.joinRules
    .filter(rule => rule.fromTable === tableName && rule.fromColumn === columnName)
    .sort((a, b) => `${a.toTable}.${a.toColumn}`.localeCompare(`${b.toTable}.${b.toColumn}`));
}

function renderRow(row) {
  const descriptionExpanded = expandedDescriptionRows.has(row.rowKey);
  return `
    <tr>
      <td>${escapeHtml(row.table)}</td>
      <td>${escapeHtml(row.column)}</td>
      <td>
        ${row.description ? `
          <button class="description-cell ${descriptionExpanded ? "expanded" : ""}" data-action="toggle-description" data-row-key="${escapeHtml(row.rowKey)}" title="Click to expand description">
            ${escapeHtml(row.description)}
          </button>
        ` : ""}
      </td>
      <td>${renderJoins(row.joins)}</td>
    </tr>
    ${expandedJoinRows.has(row.rowKey) ? renderJoinExpansion(row) : ""}
  `;
}

function updateDescriptionOverflow() {
  requestAnimationFrame(() => {
    document.querySelectorAll(".description-cell").forEach(button => {
      const expandable = button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight + 1;
      button.dataset.expandable = String(expandable);
      button.classList.toggle("expandable", expandable);
      button.title = expandable ? "Click to expand description" : "";
    });
  });
}

function startColumnResize(event) {
  const index = Number(event.target.dataset.colIndex);
  const col = els.metadataTable.querySelectorAll("col")[index];
  const header = event.target.closest("th");
  resizeState = {
    col,
    startX: event.clientX,
    startWidth: header.getBoundingClientRect().width
  };
  document.body.classList.add("resizing");
  event.preventDefault();
}

function resizeColumn(event) {
  if (!resizeState) return;
  const nextWidth = Math.max(70, resizeState.startWidth + event.clientX - resizeState.startX);
  resizeState.col.style.width = `${nextWidth}px`;
  updateDescriptionOverflow();
}

function stopColumnResize() {
  if (!resizeState) return;
  resizeState = null;
  document.body.classList.remove("resizing");
  updateDescriptionOverflow();
}

function renderJoins(joins) {
  if (!joins.length) return "";
  const first = joins[0];
  const key = `${first.fromTable}.${first.fromColumn}`;
  const expanded = expandedJoinRows.has(key);
  return `
    <button class="join-toggle" data-action="toggle-joins" data-row-key="${escapeHtml(key)}" aria-expanded="${expanded}">
      ${expanded ? "-" : "+"}
    </button>
    <span class="join-count">${joins.length}</span>
  `;
}

function renderJoinExpansion(row) {
  return `
    <tr class="join-expansion">
      <td></td>
      <td colspan="3">
        <div class="join-list">
          ${row.joins.map(join => `
            <div>
              <strong>${escapeHtml(join.toTable)}</strong>.<span>${escapeHtml(join.toColumn)}</span>
            </div>
          `).join("")}
        </div>
      </td>
    </tr>
  `;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function clearFilters() {
  [els.tableFilter, els.columnFilter, els.descriptionFilter]
    .forEach(input => input.value = "");
  renderRows();
}

function normalize(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  return text.toUpperCase() === "NULL" ? "" : text.trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function splitListValue(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}
