/*
===============================================================================
DFM Average Formula Rows - infer summary row configs from canonical labels
===============================================================================
*/

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function makeRowId(base, periods, exclude) {
  const periodPart = String(periods || "all").toLowerCase();
  if (!exclude) return `${base}_${periodPart}`;
  return `${base}_${periodPart}_ex_hi_lo${exclude > 1 ? `_x${exclude}` : ""}`;
}

function cloneSummaryRow(row) {
  const next = { ...(row || {}) };
  if (Array.isArray(row?.values)) next.values = row.values.slice();
  if (Array.isArray(row?.inputs)) next.inputs = row.inputs.slice();
  if (Array.isArray(row?.formulas)) next.formulas = row.formulas.slice();
  return next;
}

function indexRowsByLabel(rows) {
  const byLabel = new Map();
  rows.forEach((row) => {
    const label = normalizeLabel(row?.label || row?.id);
    if (label && !byLabel.has(label.toLowerCase())) {
      byLabel.set(label.toLowerCase(), row);
    }
  });
  return byLabel;
}

export function resolveDfmAverageFormulaRowFromLabel(label) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;

  const match = /^(volume|simple)\s*-\s*(all|[1-9]\d*)(?:\s+ex\s+hi\/lo(?:\s*x\s*([1-9]\d*))?)?$/i.exec(normalized);
  if (!match) return null;

  const base = match[1].toLowerCase();
  const periods = match[2].toLowerCase() === "all" ? "all" : Number(match[2]);
  const hasExclude = /\s+ex\s+hi\/lo/i.test(normalized);
  const exclude = hasExclude ? Number(match[3] || 1) : 0;

  return {
    id: makeRowId(base, periods, exclude),
    label: normalized,
    averageType: "custom",
    base,
    periods,
    exclude,
  };
}

export function buildDfmSummaryRowsFromAverageFormulas(summaryRows, formulas) {
  const sourceRows = Array.isArray(summaryRows) ? summaryRows.map(cloneSummaryRow) : [];
  if (!Array.isArray(formulas) || !formulas.length) {
    return { rows: Array.isArray(summaryRows) ? sourceRows : null, order: null, inferred: false };
  }

  const byLabel = indexRowsByLabel(sourceRows);
  const usedLabels = new Set();
  const usedIds = new Set();
  const rows = [];
  let inferred = false;

  formulas.forEach((formula) => {
    const label = normalizeLabel(formula);
    if (!label) return;
    const labelKey = label.toLowerCase();
    if (usedLabels.has(labelKey)) return;

    const existing = byLabel.get(labelKey);
    const row = existing ? cloneSummaryRow(existing) : resolveDfmAverageFormulaRowFromLabel(label);
    if (!row) return;

    if (!row.id) row.id = resolveDfmAverageFormulaRowFromLabel(label)?.id || `formula_${rows.length + 1}`;
    const rowId = String(row.id || "").trim();
    if (!rowId || usedIds.has(rowId)) return;

    rows.push(row);
    usedLabels.add(labelKey);
    usedIds.add(rowId);
    if (!existing) inferred = true;
  });

  sourceRows.forEach((row) => {
    const label = normalizeLabel(row?.label || row?.id);
    const labelKey = label.toLowerCase();
    const rowId = String(row?.id || "").trim();
    if (!rowId || usedIds.has(rowId) || usedLabels.has(labelKey)) return;
    rows.push(cloneSummaryRow(row));
    usedIds.add(rowId);
  });

  return {
    rows: rows.length ? rows : (sourceRows.length ? sourceRows : null),
    order: rows.length ? rows.map((row) => String(row.id)).filter(Boolean) : null,
    inferred,
  };
}
