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
let joinPanelFilters = {};
let joinPanelWidths = {};
let resizeState = null;
let activeJoinFilter = null;
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
  [els.tableFilter, els.columnFilter, els.descriptionFilter]
    .forEach(input => input.addEventListener("input", () => {
      updateFilterClearButtons();
      renderRows();
    }));
  els.filterRow.addEventListener("click", handleFilterClearClick);
  els.metadataRows.addEventListener("click", handleMetadataClick);
  els.metadataRows.addEventListener("input", handleMetadataInput);
  els.metadataRows.addEventListener("mousedown", startJoinColumnResize);
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
  els.themeToggle.textContent = isDark ? "☀" : "◐";
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
  restoreJoinFilterFocus();

  if (!filtered.length) {
    els.metadataRows.innerHTML = `
      <tr>
        <td colspan="4" class="empty-cell">No matching metadata.</td>
      </tr>
    `;
  }
  updateFilterClearButtons();
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

function handleMetadataInput(event) {
  const input = event.target.closest("[data-action='join-filter']");
  if (!input) return;

  const rowKey = input.dataset.rowKey;
  const field = input.dataset.field;
  joinPanelFilters[rowKey] = joinPanelFilters[rowKey] || {};
  joinPanelFilters[rowKey][field] = input.value;
  activeJoinFilter = { rowKey, field, cursor: input.selectionStart };
  renderRows();
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
      <td>${escapeHtml(row.column)}</td>
      <td>${escapeHtml(row.table)}</td>
      <td>${renderJoinToggle(row)}</td>
      <td>
        ${row.description ? `
          <button class="description-cell ${descriptionExpanded ? "expanded" : ""}" data-action="toggle-description" data-row-key="${escapeHtml(row.rowKey)}" title="Click to expand description">
            ${escapeHtml(row.description)}
          </button>
        ` : ""}
      </td>
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
    type: "main",
    col,
    startX: event.clientX,
    startWidth: header.getBoundingClientRect().width
  };
  document.body.classList.add("resizing");
  event.preventDefault();
}

function startJoinColumnResize(event) {
  const handle = event.target.closest("[data-action='resize-join-col']");
  if (!handle) return;

  const rowKey = handle.dataset.rowKey;
  const field = handle.dataset.field;
  const headerCell = handle.parentElement;
  resizeState = {
    type: "join",
    rowKey,
    field,
    startX: event.clientX,
    startWidth: headerCell.getBoundingClientRect().width
  };
  document.body.classList.add("resizing");
  event.preventDefault();
}

function resizeColumn(event) {
  if (!resizeState) return;
  const nextWidth = Math.max(70, resizeState.startWidth + event.clientX - resizeState.startX);
  if (resizeState.type === "join") {
    joinPanelWidths[resizeState.rowKey] = joinPanelWidths[resizeState.rowKey] || {};
    joinPanelWidths[resizeState.rowKey][resizeState.field] = nextWidth;
    const panel = document.querySelector(`.join-panel[data-row-key="${cssEscape(resizeState.rowKey)}"]`);
    if (panel) panel.style.setProperty(`--join-col-${resizeState.field}`, `${nextWidth}px`);
  } else {
    resizeState.col.style.width = `${nextWidth}px`;
  }
  updateDescriptionOverflow();
}

function stopColumnResize() {
  if (!resizeState) return;
  resizeState = null;
  document.body.classList.remove("resizing");
  updateDescriptionOverflow();
}

function restoreJoinFilterFocus() {
  if (!activeJoinFilter) return;
  requestAnimationFrame(() => {
    const selector = `[data-action="join-filter"][data-row-key="${cssEscape(activeJoinFilter.rowKey)}"][data-field="${activeJoinFilter.field}"]`;
    const input = document.querySelector(selector);
    if (input) {
      input.focus();
      const cursor = activeJoinFilter.cursor ?? input.value.length;
      input.setSelectionRange(cursor, cursor);
    }
    activeJoinFilter = null;
  });
}

function renderJoinToggle(row) {
  if (!row.joins.length) return "";
  const expanded = expandedJoinRows.has(row.rowKey);
  return `
    <button class="join-toggle" data-action="toggle-joins" data-row-key="${escapeHtml(row.rowKey)}" aria-expanded="${expanded}" title="Show joins">
      ${expanded ? "-" : "+"}
    </button>
  `;
}

function renderJoinExpansion(row) {
  const filters = joinPanelFilters[row.rowKey] || {};
  const visibleJoins = row.joins.filter(join => {
    const targetColumn = db.tables[join.toTable]?.columns?.[join.toColumn];
    const targetDescription = targetColumn?.description || "";
    if (filters.column && !join.toColumn.includes(filters.column.trim().toUpperCase())) return false;
    if (filters.table && !join.toTable.includes(filters.table.trim().toUpperCase())) return false;
    if (filters.description && !targetDescription.toUpperCase().includes(filters.description.trim().toUpperCase())) return false;
    return true;
  });
  const widths = joinPanelWidths[row.rowKey] || {};
  const style = [
    widths.column ? `--join-col-column:${widths.column}px` : "",
    widths.table ? `--join-col-table:${widths.table}px` : "",
    widths.description ? `--join-col-description:${widths.description}px` : ""
  ].filter(Boolean).join(";");

  return `
    <tr class="join-expansion">
      <td></td>
      <td></td>
      <td colspan="2">
        <div class="join-panel" data-row-key="${escapeHtml(row.rowKey)}" style="${escapeHtml(style)}">
          <div class="join-panel-header">
            <span>
              <input class="join-header-filter" data-action="join-filter" data-row-key="${escapeHtml(row.rowKey)}" data-field="column" value="${escapeHtml(filters.column || "")}" placeholder="Column" />
              <span class="join-resize-handle" data-action="resize-join-col" data-row-key="${escapeHtml(row.rowKey)}" data-field="column"></span>
            </span>
            <span>
              <input class="join-header-filter" data-action="join-filter" data-row-key="${escapeHtml(row.rowKey)}" data-field="table" value="${escapeHtml(filters.table || "")}" placeholder="Table" />
              <span class="join-resize-handle" data-action="resize-join-col" data-row-key="${escapeHtml(row.rowKey)}" data-field="table"></span>
            </span>
            <span>
              <input class="join-header-filter" data-action="join-filter" data-row-key="${escapeHtml(row.rowKey)}" data-field="description" value="${escapeHtml(filters.description || "")}" placeholder="Description" />
              <span class="join-resize-handle" data-action="resize-join-col" data-row-key="${escapeHtml(row.rowKey)}" data-field="description"></span>
            </span>
          </div>
          ${visibleJoins.length ? visibleJoins.map(join => renderJoinTarget(join)).join("") : `<div class="join-target empty-join-target"><span>No matching joins.</span><strong></strong><p></p></div>`}
        </div>
      </td>
    </tr>
  `;
}

function renderJoinTarget(join) {
  const targetColumn = db.tables[join.toTable]?.columns?.[join.toColumn];
  const targetDescription = targetColumn?.description || "";
  return `
    <div class="join-target">
      <span>${escapeHtml(join.toColumn)}</span>
      <strong>${escapeHtml(join.toTable)}</strong>
      <p>${targetDescription ? escapeHtml(targetDescription) : ""}</p>
    </div>
  `;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function handleFilterClearClick(event) {
  const button = event.target.closest("[data-clear-filter]");
  if (!button) return;

  const input = document.getElementById(button.dataset.clearFilter);
  if (!input || !input.value) return;
  input.value = "";
  input.focus();
  updateFilterClearButtons();
  renderRows();
}

function updateFilterClearButtons() {
  document.querySelectorAll("[data-clear-filter]").forEach(button => {
    const input = document.getElementById(button.dataset.clearFilter);
    button.classList.toggle("visible", Boolean(input?.value));
  });
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

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function splitListValue(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}
