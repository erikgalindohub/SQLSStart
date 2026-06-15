function buildRows() {
  return (db.sourceTables || [])
    .filter(tableName => db.tables[tableName])
    .flatMap(tableName => {
      const table = db.tables[tableName];
      return Object.values(table.columns || {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(column => {
          const joins = getJoins(tableName, column.name);
          const columnMatches = getColumnMatches(tableName, column.name, joins);
          const joinText = joins.map(join => `${join.toTable}.${join.toColumn}`).join("; ");
          const matchText = columnMatches.map(match => `${match.table}.${match.column}`).join("; ");
          return {
            table: tableName,
            column: column.name,
            description: column.description || "",
            joins,
            columnMatches,
            joinText,
            matchText,
            rowKey: `${tableName}.${column.name}`,
            searchText: [tableName, column.name, column.description || "", joinText, matchText].join(" ").toUpperCase()
          };
        });
    });
}

function getColumnMatches(tableName, columnName, joins = []) {
  const officialTargets = new Set(joins.map(join => `${join.toTable}.${join.toColumn}`));
  const columnsToCheck = joins.length ? [...new Set(joins.map(join => join.toColumn))] : [columnName];

  return Object.entries(db.tables || {})
    .flatMap(([candidateTable, table]) => columnsToCheck
      .filter(candidateColumn => table.columns?.[candidateColumn])
      .map(candidateColumn => ({
        table: candidateTable,
        column: candidateColumn,
        description: table.columns[candidateColumn].description || ""
      })))
    .filter(match => match.table !== tableName)
    .filter(match => !officialTargets.has(`${match.table}.${match.column}`))
    .sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

function renderJoinToggle(row) {
  if (!row.joins.length && !row.columnMatches.length) return "";
  const expanded = expandedJoinRows.has(row.rowKey);
  return `
    <button class="join-toggle" data-action="toggle-joins" data-row-key="${escapeHtml(row.rowKey)}" aria-expanded="${expanded}" title="Show official joins and column matches">
      ${expanded ? "-" : "+"}
    </button>
  `;
}

function renderJoinExpansion(row) {
  const filters = joinPanelFilters[row.rowKey] || {};
  const visibleJoins = row.joins.filter(join => relationshipPassesFilters(join.toColumn, join.toTable, getJoinDescription(join, row), filters));
  const visibleMatches = row.columnMatches.filter(match => relationshipPassesFilters(match.column, match.table, match.description, filters));
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
          <p class="join-note">Official joins come from JSON relationship metadata. Column matches are discovery hints only.</p>
          ${renderJoinPanelHeader(row.rowKey, filters)}
          <h3 class="join-section-title">Official Join(s)</h3>
          ${visibleJoins.length ? visibleJoins.map(join => renderOfficialJoinTarget(row, join)).join("") : `<div class="join-target empty-join-target"><span>No official joins match these filters.</span><strong></strong><p></p></div>`}
          <h3 class="join-section-title muted">Other Tables Containing Matching Column</h3>
          ${visibleMatches.length ? visibleMatches.map(renderColumnMatchTarget).join("") : `<div class="join-target empty-join-target"><span>No other matching columns found.</span><strong></strong><p></p></div>`}
        </div>
      </td>
    </tr>
  `;
}

function relationshipPassesFilters(column, table, description, filters) {
  if (filters.column && !column.includes(filters.column.trim().toUpperCase())) return false;
  if (filters.table && !table.includes(filters.table.trim().toUpperCase())) return false;
  if (filters.description && !description.toUpperCase().includes(filters.description.trim().toUpperCase())) return false;
  return true;
}

function renderJoinPanelHeader(rowKey, filters) {
  return `
    <div class="join-panel-header">
      <span><input class="join-header-filter" data-action="join-filter" data-row-key="${escapeHtml(rowKey)}" data-field="column" value="${escapeHtml(filters.column || "")}" placeholder="Column" /><span class="join-resize-handle" data-action="resize-join-col" data-row-key="${escapeHtml(rowKey)}" data-field="column"></span></span>
      <span><input class="join-header-filter" data-action="join-filter" data-row-key="${escapeHtml(rowKey)}" data-field="table" value="${escapeHtml(filters.table || "")}" placeholder="Table" /><span class="join-resize-handle" data-action="resize-join-col" data-row-key="${escapeHtml(rowKey)}" data-field="table"></span></span>
      <span><input class="join-header-filter" data-action="join-filter" data-row-key="${escapeHtml(rowKey)}" data-field="description" value="${escapeHtml(filters.description || "")}" placeholder="Description" /><span class="join-resize-handle" data-action="resize-join-col" data-row-key="${escapeHtml(rowKey)}" data-field="description"></span></span>
    </div>
  `;
}

function renderOfficialJoinTarget(row, join) {
  const description = getJoinDescription(join, row);
  return `
    <div class="join-target official-join-target">
      <span>${escapeHtml(join.toColumn)}</span>
      <strong>${escapeHtml(join.toTable)}</strong>
      <p><b>${escapeHtml(row.table)}.${escapeHtml(row.column)} = ${escapeHtml(join.toTable)}.${escapeHtml(join.toColumn)}</b>${description ? `<br>${escapeHtml(description)}` : ""}</p>
    </div>
  `;
}

function renderColumnMatchTarget(match) {
  return `
    <div class="join-target column-match-target">
      <span>${escapeHtml(match.column)}</span>
      <strong>${escapeHtml(match.table)}</strong>
      <p>${match.description ? escapeHtml(match.description) : "Column name match only; not a documented join."}</p>
    </div>
  `;
}

function getJoinDescription(join, row) {
  const targetColumn = db.tables[join.toTable]?.columns?.[join.toColumn];
  return targetColumn?.description || row.description || "";
}