/*
===============================================================================
DFM Persistence - load/save ratio selections to disk via host API
===============================================================================
*/
import {
  state,
  ratioStrikeSet,
  selectedSummaryByCol,
  summaryRowConfigs,
  BASE_SUMMARY_ROWS,
  RATIO_SAVE_PATH_KEY,
  getHostApi,
  buildRatioSavePath,
  getRatioSaveBaseDir,
  getRatioDataDir,
  getRatioSaveSuggestedName,
  getResultsCsvSuggestedName,
  buildSummaryRows,
  markDfmClean,
  isRatiosTabVisible,
  isResultsTabVisible,
  getDfmIsDirty,
  sanitizeFileNamePart,
  getRatioSaveProjectName,
  getResolvedReservingClass,
  getDfmDecimalPlaces,
  getEffectiveDevLabelsForModel,
  getRatioHeaderLabels,
} from "/ui/dfm/dfm_state.js";
import {
  getSummaryConfigKey,
  getSummaryOrderKey,
  saveCustomSummaryRows,
  loadCustomSummaryRows,
  saveSummaryOrder,
  loadSummaryOrder,
  markMethodSaved,
  clearMethodSavedFlag,
} from "/ui/dfm/dfm_storage.js";
import {
  buildRatioSelectionPattern,
  applyRatioSelectionPattern,
  buildAverageSelectionPayload,
  applyAverageSelectionFromSaved,
  renderRatioTable,
} from "/ui/dfm/dfm_ratios_tab.js";
import {
  renderResultsTable,
  buildResultsVector,
  buildResultsVectorCsv,
  getResultsRatioBasisSelection,
  getResultsUltimateRatioDecimalPlacesSelection,
  setResultsRatioBasisSelection,
  setResultsUltimateRatioDecimalPlacesSelection,
} from "/ui/dfm/dfm_results_tab.js";
import { getDfmNotesText, setDfmNotesText } from "/ui/dfm/dfm_notes_tab.js";
import {
  hideDfmSettingsLoadingPopup,
  showDfmSettingsLoadingPopup,
} from "/ui/dfm/dfm_loading_popup.js";
import { buildDfmSummaryRowsFromAverageFormulas } from "/ui/dfm/dfm_average_formula_rows.js";

let ratioLoadTimer = null;
let ratioLoadPendingReason = "";
const DFM_INSTANCE_PRESENCE_EVENT = "arcrho:dfm-instance-presence";
const DFM_LOCAL_LOOKUP_DEBUG_STATUS = true; // Temporary debug aid.

function getRatioLoadReasonPriority(reason) {
  const key = String(reason || "").trim().toLowerCase();
  switch (key) {
    case "details-change":
      return 50;
    case "global-changed":
    case "dataset-updated":
      return 40;
    case "init":
      return 30;
    case "tab-activated":
      return 10;
    default:
      return 20;
  }
}

function chooseRatioLoadReason(prevReason, nextReason) {
  const prev = String(prevReason || "").trim();
  const next = String(nextReason || "").trim();
  if (!prev) return next;
  if (!next) return prev;
  return getRatioLoadReasonPriority(next) >= getRatioLoadReasonPriority(prev) ? next : prev;
}

function emitDfmInstancePresence(status) {
  try {
    window.dispatchEvent(new CustomEvent(DFM_INSTANCE_PRESENCE_EVENT, { detail: { status } }));
  } catch {
    // ignore
  }
}

function getTrimmedInputValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function postDfmStatus(text, options = {}) {
  window.parent.postMessage(
    {
      type: "arcrho:status",
      text: String(text || ""),
      ...(options?.tone ? { tone: options.tone } : {}),
    },
    "*",
  );
}

function postDfmLookupDebugStatus(text, options = {}) {
  if (!DFM_LOCAL_LOOKUP_DEBUG_STATUS) return;
  const reason = String(options?.reason || "").trim();
  const suffix = reason ? ` [${reason}]` : "";
  postDfmStatus(`Debug: DFM local method lookup ${text}${suffix}`);
}

function hasRequiredDfmInputs() {
  const project = getTrimmedInputValue("projectSelect");
  const reservingClass = getTrimmedInputValue("pathInput");
  const tri = getTrimmedInputValue("triInput");
  const outputVector = getTrimmedInputValue("dfmOutputVector");
  const methodName = getTrimmedInputValue("dfmMethodName");
  const originLen = getTrimmedInputValue("originLenSelect");
  const devLen = getTrimmedInputValue("devLenSelect");
  return !!(project && reservingClass && tri && outputVector && methodName && originLen && devLen);
}

function hasRequiredDfmLookupInputs() {
  const project = getTrimmedInputValue("projectSelect");
  const reservingClass = getTrimmedInputValue("pathInput");
  const methodName = getTrimmedInputValue("dfmMethodName");
  return !!(project && reservingClass && methodName);
}

function getSavedInputTriangleValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("input triangle" in payload) return String(payload["input triangle"] ?? "");
  return null;
}

function normalizeSavedLengthValue(value) {
  const raw = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(raw) && raw > 0 ? String(raw) : "";
}

function readSelectedLengthNumber(id, fallback = 12) {
  const raw = Number.parseInt(getTrimmedInputValue(id), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function getSavedOriginLengthValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("origin length" in payload) return normalizeSavedLengthValue(payload["origin length"]);
  return null;
}

function getSavedDevelopmentLengthValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("development length" in payload) return normalizeSavedLengthValue(payload["development length"]);
  return null;
}

function applySavedSelectValueToUi(id, rawValue) {
  if (rawValue == null) return;
  const select = document.getElementById(id);
  if (!select) return;
  const next = String(rawValue ?? "").trim();
  if (!next) return;
  if (![...select.options].some((opt) => String(opt.value) === next)) {
    const opt = document.createElement("option");
    opt.value = next;
    opt.textContent = next;
    select.appendChild(opt);
  }
  if (String(select.value ?? "") === next) return;
  select.value = next;
}

function getSavedMethodNameValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("name" in payload) return String(payload["name"] ?? "");
  return null;
}

function applySavedMethodNameToUi(rawValue) {
  if (rawValue == null) return;
  const input = document.getElementById("dfmMethodName");
  if (!input) return;
  const next = String(rawValue ?? "").trim();
  const prev = String(input.value || "").trim();
  if (next === prev) return;
  input.dataset.programmatic = "1";
  input.value = next;
  // `wireMethodName()` handles title/localStorage sync on input without triggering
  // another local-method lookup.
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function getSavedOutputTypeValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("output type" in payload) return String(payload["output type"] ?? "");
  return null;
}

function applySavedOutputTypeToUi(rawValue) {
  if (rawValue == null) return;
  const input = document.getElementById("dfmOutputVector");
  if (!input) return;
  const next = String(rawValue ?? "").trim();
  const prev = String(input.value || "").trim();
  if (next === prev) return;
  input.value = next;
  // Keep the picker module's committed value in sync without opening/revalidating
  // the dropdown during programmatic load.
  input.dispatchEvent(new CustomEvent("arcrho:output-type-selected", { detail: { value: next } }));
}

function applySavedInputTriangleToUi(rawValue) {
  if (rawValue == null) return;
  const triInput = document.getElementById("triInput");
  if (!triInput) return;
  const next = String(rawValue ?? "").trim();
  const prev = String(triInput.value || "").trim();
  if (next === prev) return;
  triInput.value = next;
  triInput.dispatchEvent(new Event("input", { bubbles: true }));
  triInput.dispatchEvent(new Event("change", { bubbles: true }));
}

function getSavedDecimalPlacesValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("decimal places" in payload) return payload["decimal places"];
  return null;
}

function applySavedDecimalPlacesToUi(rawValue) {
  if (rawValue == null) return;
  const input = document.getElementById("decimalPlaces");
  if (!input) return;
  const parsed = Number.parseInt(String(rawValue).trim(), 10);
  if (!Number.isFinite(parsed)) return;
  const normalized = String(Math.max(0, Math.min(6, parsed)));
  if (String(input.value ?? "") === normalized) return;
  input.dataset.programmatic = "1";
  input.value = normalized;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function getSavedUltimateRatioDecimalPlacesValue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("ultimate ratio decimal places" in payload) return payload["ultimate ratio decimal places"];
  return null;
}

const MONTH_NAME_TO_NUM = new Map([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

function parseOriginStartMonth(label, baseLen) {
  const s = String(label || "").trim();
  if (!s) return null;

  if (baseLen === 1) {
    const yyyymm = s.match(/^(\d{4})(\d{2})$/);
    if (yyyymm) {
      const year = Number.parseInt(yyyymm[1], 10);
      const month = Number.parseInt(yyyymm[2], 10);
      if (Number.isFinite(year) && month >= 1 && month <= 12) return { year, month };
    }
    const monYear = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
    if (monYear) {
      const month = MONTH_NAME_TO_NUM.get(monYear[1].toLowerCase());
      const year = Number.parseInt(monYear[2], 10);
      if (month && Number.isFinite(year)) return { year, month };
    }
    return null;
  }

  if (baseLen === 3) {
    const yq = s.match(/^(\d{4})\s*Q([1-4])$/i);
    if (yq) {
      const year = Number.parseInt(yq[1], 10);
      const q = Number.parseInt(yq[2], 10);
      return { year, month: (q - 1) * 3 + 1 };
    }
    const qy = s.match(/^Q([1-4])\s*(\d{4})$/i);
    if (qy) {
      const q = Number.parseInt(qy[1], 10);
      const year = Number.parseInt(qy[2], 10);
      return { year, month: (q - 1) * 3 + 1 };
    }
    return null;
  }

  if (baseLen === 6) {
    const yh = s.match(/^(\d{4})\s*H([1-2])$/i);
    if (yh) {
      const year = Number.parseInt(yh[1], 10);
      const h = Number.parseInt(yh[2], 10);
      return { year, month: (h - 1) * 6 + 1 };
    }
    const hy = s.match(/^H([1-2])\s*(\d{4})$/i);
    if (hy) {
      const h = Number.parseInt(hy[1], 10);
      const year = Number.parseInt(hy[2], 10);
      return { year, month: (h - 1) * 6 + 1 };
    }
    return null;
  }

  if (baseLen === 12) {
    const yearOnly = s.match(/^(\d{4})$/);
    if (yearOnly) {
      const year = Number.parseInt(yearOnly[1], 10);
      if (Number.isFinite(year)) return { year, month: 1 };
    }
    return null;
  }

  return null;
}

function aggregateResultsVectorByLength(vector, originLabels, baseLen, targetLen) {
  if (!Array.isArray(vector) || !vector.length) return [];
  const factor = targetLen / baseLen;
  if (!Number.isFinite(factor) || factor <= 1 || Math.floor(factor) !== factor) return [];

  const labels = Array.isArray(originLabels) ? originLabels : [];
  const canUseLabelBuckets = labels.length === vector.length && (baseLen === 1 || baseLen === 3 || baseLen === 6 || baseLen === 12);
  if (canUseLabelBuckets) {
    const orderedKeys = [];
    const bucketMap = new Map();
    let parseFailed = false;
    for (let i = 0; i < vector.length; i++) {
      const parsed = parseOriginStartMonth(labels[i], baseLen);
      if (!parsed) {
        parseFailed = true;
        break;
      }
      const bucketMonth = Math.floor((parsed.month - 1) / targetLen) * targetLen + 1;
      const key = `${parsed.year}-${bucketMonth}`;
      if (!bucketMap.has(key)) {
        bucketMap.set(key, { sum: 0, hasValue: false });
        orderedKeys.push(key);
      }
      const bucket = bucketMap.get(key);
      const num = Number(vector[i]);
      if (Number.isFinite(num)) {
        bucket.sum += num;
        bucket.hasValue = true;
      }
    }
    if (!parseFailed) {
      return orderedKeys.map((key) => {
        const bucket = bucketMap.get(key);
        return bucket?.hasValue ? bucket.sum : null;
      });
    }
  }

  const out = [];
  for (let i = 0; i < vector.length; i += factor) {
    let sum = 0;
    let hasValue = false;
    const end = Math.min(i + factor, vector.length);
    for (let j = i; j < end; j++) {
      const num = Number(vector[j]);
      if (!Number.isFinite(num)) continue;
      sum += num;
      hasValue = true;
    }
    out.push(hasValue ? sum : null);
  }
  return out;
}

function buildAggregatedResultVariants(resultVector) {
  const baseOriginRaw = Number.parseInt(String(document.getElementById("originLenSelect")?.value || "").trim(), 10);
  const baseLen = Number.isFinite(baseOriginRaw) ? baseOriginRaw : 12;
  const targetLens = [3, 6, 12].filter((len) => len > baseLen && len % baseLen === 0);
  if (!targetLens.length) return [];

  const originLabels = Array.isArray(state?.model?.origin_labels) ? state.model.origin_labels : [];
  const out = [];
  for (const targetLen of targetLens) {
    const vec = aggregateResultsVectorByLength(resultVector, originLabels, baseLen, targetLen);
    if (!vec.length) continue;
    out.push({
      originLen: targetLen,
      devLen: targetLen,
      vector: vec,
    });
  }
  return out;
}

function getSummaryRowsForPersistence(cfgKey) {
  const savedSummaryRows = cfgKey ? loadCustomSummaryRows(cfgKey) : [];
  const sourceRows = savedSummaryRows.length
    ? savedSummaryRows
    : (summaryRowConfigs.length ? summaryRowConfigs : BASE_SUMMARY_ROWS);
  return sourceRows.map((row) => ({ ...row }));
}

export async function applyDfmMethodPayload(payload, options = {}) {
  if (payload && !Array.isArray(payload)) {
    applySavedSelectValueToUi("originLenSelect", getSavedOriginLengthValue(payload));
    applySavedSelectValueToUi("devLenSelect", getSavedDevelopmentLengthValue(payload));
  }

  const pattern = Array.isArray(payload) ? payload : payload?.["ratio pattern"];
  const applied = applyRatioSelectionPattern(pattern);
  if (payload && !Array.isArray(payload)) {
    const cfgKey = getSummaryConfigKey();
    const orderKey = getSummaryOrderKey();
    const formulas = payload["average formulas"];
    const matrix = payload["average index"];
    const resolvedSummary = buildDfmSummaryRowsFromAverageFormulas(payload["summary rows"], formulas);
    const summaryRows = resolvedSummary.rows;
    const summaryOrder = resolvedSummary.inferred ? resolvedSummary.order : payload["summary order"];
    let summaryUpdated = false;

    if (Array.isArray(summaryRows) && cfgKey) {
      saveCustomSummaryRows(cfgKey, summaryRows);
      summaryUpdated = true;
    }
    if (Array.isArray(summaryOrder) && orderKey) {
      saveSummaryOrder(orderKey, summaryOrder);
      summaryUpdated = true;
    }
    if (summaryUpdated) buildSummaryRows();

    const notesText = payload["notes"];
    const savedMethodName = getSavedMethodNameValue(payload);
    const savedOutputType = getSavedOutputTypeValue(payload);
    const savedInputTriangle = getSavedInputTriangleValue(payload);
    const savedDecimalPlaces = getSavedDecimalPlacesValue(payload);
    const savedUltimateRatioDecimalPlaces = getSavedUltimateRatioDecimalPlacesValue(payload);
    const ratioBasisDataset = payload["ratio basis dataset"] ?? "";
    applySavedOutputTypeToUi(savedOutputType);
    applySavedInputTriangleToUi(savedInputTriangle);
    // Apply saved Name after tri-input restore because tri change triggers
    // syncMethodNameFromInputs(), which otherwise can overwrite custom Names
    // with Output Vector during load.
    applySavedMethodNameToUi(savedMethodName);
    applySavedDecimalPlacesToUi(savedDecimalPlaces);
    setResultsUltimateRatioDecimalPlacesSelection(savedUltimateRatioDecimalPlaces, { silent: true, render: false });
    setDfmNotesText(notesText);
    await setResultsRatioBasisSelection(ratioBasisDataset, { silent: true, render: false });
    if (Array.isArray(formulas) && Array.isArray(matrix)) {
      applyAverageSelectionFromSaved(formulas, matrix);
    }
  } else {
    setDfmNotesText("");
    await setResultsRatioBasisSelection("", { silent: true, render: false });
  }

  if (applied && options.render !== false) {
    if (isRatiosTabVisible()) renderRatioTable();
    if (isResultsTabVisible()) renderResultsTable();
  }
  if (applied && options.markClean !== false) {
    markMethodSaved();
    markDfmClean();
  }
  return { ok: applied };
}

export async function loadRatioSelectionIfExists(reason) {
  postDfmLookupDebugStatus("triggered", { reason });
  if (!hasRequiredDfmLookupInputs()) {
    postDfmLookupDebugStatus("skipped (waiting for required fields)", { reason });
    emitDfmInstancePresence("incomplete");
    return;
  }
  if (getDfmIsDirty() && reason === "tab-activated") {
    postDfmLookupDebugStatus("skipped (dirty + tab-activated)", { reason });
    return;
  }
  const hostApi = getHostApi();
  if (!hostApi || typeof hostApi.readJsonFile !== "function") {
    postDfmLookupDebugStatus("skipped (desktop host readJsonFile unavailable)", { reason });
    emitDfmInstancePresence("incomplete");
    return;
  }
  const standardPath = await buildRatioSavePath();
  let path = standardPath;
  postDfmLookupDebugStatus(`checking ${path}`, { reason });
  const loadingToken = showDfmSettingsLoadingPopup("Loading saved DFM settings...");
  try {
    const result = await hostApi.readJsonFile({ path });
    if (!result || !result.exists) {
      emitDfmInstancePresence("missing");
      postDfmStatus("This method object has not been created yet, changes will be saved to a new container.", { tone: "warn" });
      if (getDfmIsDirty()) {
        return;
      }
      ratioStrikeSet.clear();
      selectedSummaryByCol.clear();
      setDfmNotesText("");
      await setResultsRatioBasisSelection("", { silent: true, render: false });
      clearMethodSavedFlag();
      if (isRatiosTabVisible()) renderRatioTable();
      if (isResultsTabVisible()) renderResultsTable();
      return;
    }
    emitDfmInstancePresence("found");
    const applied = await applyDfmMethodPayload(result.data);
    if (applied.ok) {
      postDfmStatus(`Ready: Loaded method settings from ${path}`);
    } else if (reason) {
      postDfmStatus("Error: Ratio file found but could not be applied.");
    }
  } finally {
    hideDfmSettingsLoadingPopup(loadingToken);
  }
}

export function scheduleRatioSelectionLoad(reason) {
  ratioLoadPendingReason = chooseRatioLoadReason(ratioLoadPendingReason, reason);
  if (ratioLoadTimer) clearTimeout(ratioLoadTimer);
  ratioLoadTimer = setTimeout(() => {
    const scheduledReason = ratioLoadPendingReason || reason;
    ratioLoadPendingReason = "";
    ratioLoadTimer = null;
    loadRatioSelectionIfExists(scheduledReason);
  }, 120);
}

export async function saveRatioSelectionPattern(forceSaveAs) {
  const hostApi = getHostApi();
  if (!hostApi || typeof hostApi.saveJsonFile !== "function") {
    alert("Save requires the desktop app.");
    window.parent.postMessage({ type: "arcrho:status", text: "Save failed: desktop app required." }, "*");
    return { ok: false, error: "desktop app required" };
  }
  const pattern = buildRatioSelectionPattern();
  const originLabels = Array.isArray(state?.model?.origin_labels)
    ? state.model.origin_labels.map((label) => String(label ?? ""))
    : [];
  const developmentLabels = getRatioHeaderLabels(getEffectiveDevLabelsForModel(state?.model || {}))
    .map((label) => String(label ?? ""));
  const avgSelection = buildAverageSelectionPayload();
  const resultVector = buildResultsVector();
  const notesText = getDfmNotesText();
  const ratioBasisDataset = getResultsRatioBasisSelection();
  const outputVector = getTrimmedInputValue("dfmOutputVector");
  const methodName = getTrimmedInputValue("dfmMethodName");
  const inputTriangle = getTrimmedInputValue("triInput");
  const originLength = readSelectedLengthNumber("originLenSelect");
  const developmentLength = readSelectedLengthNumber("devLenSelect");
  const decimalPlaces = getDfmDecimalPlaces();
  const ultimateRatioDecimalPlaces = getResultsUltimateRatioDecimalPlacesSelection();
  const cfgKey = getSummaryConfigKey();
  const orderKey = getSummaryOrderKey();
  const lastModified = new Date().toISOString();
  const summaryRows = getSummaryRowsForPersistence(cfgKey);
  let summaryOrder = orderKey ? loadSummaryOrder(orderKey) : null;
  if (!Array.isArray(summaryOrder) || summaryOrder.length === 0) {
    summaryOrder = summaryRowConfigs
      .map((row) => row.id)
      .filter((id) => id != null && String(id).trim() !== "");
    if (orderKey && summaryOrder.length) {
      saveSummaryOrder(orderKey, summaryOrder);
    }
  }
  const payload = {
    data: {
      "ratio pattern": pattern,
      "origin labels": originLabels,
      "development labels": developmentLabels,
      "average formulas": avgSelection.formulas,
      "average index": avgSelection.matrix,
      "summary rows": summaryRows,
      "ultimate vector": resultVector,
      notes: notesText,
      name: methodName,
      "output type": outputVector,
      "input triangle": inputTriangle,
      "origin length": originLength,
      "development length": developmentLength,
      "decimal places": decimalPlaces,
      "ultimate ratio decimal places": ultimateRatioDecimalPlaces,
      "ratio basis dataset": ratioBasisDataset,
      "last modified": lastModified,
    },
    suggestedName: getRatioSaveSuggestedName(),
    startDir: await getRatioSaveBaseDir(),
  };
  if (Array.isArray(summaryOrder) && summaryOrder.length) {
    payload.data["summary order"] = summaryOrder;
  }
  if (!forceSaveAs) {
    payload.path = await buildRatioSavePath();
  }
  const result = await hostApi.saveJsonFile(payload);
  if (result && result.path) {
    try {
      localStorage.setItem(RATIO_SAVE_PATH_KEY, result.path);
    } catch {}
    let csvPath = "";
    let csvError = "";
    const aggregatedCsvPaths = [];
    let baseCsvSaved = false;
    if (typeof hostApi.saveTextFile === "function") {
      const csvErrors = [];
      try {
        const dataDir = await getRatioDataDir();
        csvPath = `${dataDir}\\${getResultsCsvSuggestedName()}`;
        const csvOut = await hostApi.saveTextFile({
          path: csvPath,
          data: buildResultsVectorCsv(resultVector),
        });
        if (!csvOut || csvOut.error) {
          csvErrors.push(csvOut?.error ? String(csvOut.error) : "unknown error");
        } else {
          baseCsvSaved = true;
          const variants = buildAggregatedResultVariants(resultVector);
          for (const variant of variants) {
            const aggPath = `${dataDir}\\${getResultsCsvSuggestedName({
              originLen: variant.originLen,
              devLen: variant.devLen,
            })}`;
            if (aggPath.toLowerCase() === csvPath.toLowerCase()) continue;
            const aggOut = await hostApi.saveTextFile({
              path: aggPath,
              data: buildResultsVectorCsv(variant.vector),
            });
            if (!aggOut || aggOut.error) {
              csvErrors.push(`${aggPath}: ${aggOut?.error ? String(aggOut.error) : "unknown error"}`);
              continue;
            }
            aggregatedCsvPaths.push(aggPath);
          }
        }
      } catch (err) {
        csvErrors.push(String(err?.message || err));
      }
      csvError = csvErrors.join("; ");
    } else {
      csvError = "desktop host does not support csv save";
    }
    markMethodSaved();
    markDfmClean();
    emitDfmInstancePresence("found");
    const time = new Date().toLocaleTimeString();
    let statusText = `Method saved at ${time}: ${result.path}`;
    if (baseCsvSaved) {
      statusText += ` | CSV saved: ${csvPath}${aggregatedCsvPaths.length ? ` (+${aggregatedCsvPaths.length} aggregated)` : ""}`;
    }
    if (csvError) {
      statusText += ` | CSV save failed: ${csvError}`;
    }
    window.parent.postMessage(
      { type: "arcrho:status", text: statusText },
      "*"
    );
    return { ok: true, path: result.path, csvPath, csvError, aggregatedCsvPaths };
  } else if (result && result.error) {
    window.parent.postMessage({ type: "arcrho:status", text: `Save failed: ${result.error}` }, "*");
    return { ok: false, error: result.error };
  } else {
    window.parent.postMessage({ type: "arcrho:status", text: "Save canceled." }, "*");
    return { ok: false, canceled: true };
  }
}

export async function saveDfmTemplate() {
  const hostApi = getHostApi();
  if (!hostApi || typeof hostApi.saveJsonFile !== "function") {
    alert("Save requires the desktop app.");
    window.parent.postMessage({ type: "arcrho:status", text: "Save failed: desktop app required." }, "*");
    return;
  }

  const avgSelection = buildAverageSelectionPayload();
  const cfgKey = getSummaryConfigKey();
  const orderKey = getSummaryOrderKey();
  const summaryRows = getSummaryRowsForPersistence(cfgKey);
  let summaryOrder = orderKey ? loadSummaryOrder(orderKey) : null;
  if (!Array.isArray(summaryOrder) || summaryOrder.length === 0) {
    summaryOrder = summaryRowConfigs
      .map((row) => row.id)
      .filter((id) => id != null && String(id).trim() !== "");
  }

  const data = {
    "origin length": readSelectedLengthNumber("originLenSelect"),
    "development length": readSelectedLengthNumber("devLenSelect"),
    "average formulas": avgSelection.formulas,
    "average index": avgSelection.matrix,
    "summary rows": summaryRows,
  };
  if (Array.isArray(summaryOrder) && summaryOrder.length) {
    data["summary order"] = summaryOrder;
  }

  const project = sanitizeFileNamePart(getRatioSaveProjectName(), "UnknownProject");
  const rc = sanitizeFileNamePart(getResolvedReservingClass() || "ReservingClass", "ReservingClass");
  const suggestedName = `DFM_Template@${project}@${rc}.arc-dfm`;

  let startDir = "";
  try {
    const dirRes = await fetch("/template/default_dir");
    if (dirRes.ok) {
      const dirData = await dirRes.json();
      startDir = dirData.path || "";
    }
  } catch {}

  const result = await hostApi.saveJsonFile({
    data,
    suggestedName,
    startDir,
    filters: [{ name: "DFM Template", extensions: ["arc-dfm"] }],
  });

  if (result && result.path) {
    const time = new Date().toLocaleTimeString();
    window.parent.postMessage({ type: "arcrho:status", text: `Template saved at ${time}: ${result.path}` }, "*");
  } else if (result && result.error) {
    window.parent.postMessage({ type: "arcrho:status", text: `Template save failed: ${result.error}` }, "*");
  } else {
    window.parent.postMessage({ type: "arcrho:status", text: "Template save canceled." }, "*");
  }
}

export async function loadDfmTemplate() {
  const hostApi = getHostApi();
  if (!hostApi) {
    alert("Load requires the desktop app.");
    return;
  }

  const pickFn = hostApi.pickOpenFile || null;
  if (!pickFn) {
    alert("Load requires the desktop app.");
    return;
  }

  let startDir = "";
  try {
    const dirRes = await fetch("/template/default_dir");
    if (dirRes.ok) {
      const dirData = await dirRes.json();
      startDir = dirData.path || "";
    }
  } catch {}

  const filePath = await pickFn({
    startDir,
    filters: [{ name: "DFM Template", extensions: ["arc-dfm"] }],
  });
  if (!filePath) return;

  const fileResult = await hostApi.readJsonFile({ path: filePath });
  if (!fileResult || !fileResult.exists || !fileResult.data) {
    window.parent.postMessage({ type: "arcrho:status", text: "Failed to read template file." }, "*");
    return;
  }

  const payload = fileResult.data;

  /* Apply origin / development lengths */
  const originEl = document.getElementById("originLenSelect");
  const devEl = document.getElementById("devLenSelect");
  const ensureOption = (sel, val) => {
    if (!sel || !val) return;
    if (![...sel.options].some((o) => o.value === String(val))) {
      const opt = document.createElement("option");
      opt.value = String(val);
      opt.textContent = String(val);
      sel.appendChild(opt);
    }
    sel.value = String(val);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (payload["origin length"]) ensureOption(originEl, payload["origin length"]);
  if (payload["development length"]) ensureOption(devEl, payload["development length"]);

  /* Apply summary rows */
  const cfgKey = getSummaryConfigKey();
  const orderKey = getSummaryOrderKey();
  const formulas = payload["average formulas"];
  const matrix = payload["average index"];
  const resolvedSummary = buildDfmSummaryRowsFromAverageFormulas(payload["summary rows"], formulas);
  const summaryRows = resolvedSummary.rows;
  const summaryOrder = resolvedSummary.inferred ? resolvedSummary.order : payload["summary order"];
  if (Array.isArray(summaryRows) && cfgKey) {
    saveCustomSummaryRows(cfgKey, summaryRows);
  }
  if (Array.isArray(summaryOrder) && orderKey) {
    saveSummaryOrder(orderKey, summaryOrder);
  }
  buildSummaryRows();

  /* Apply average formula selections */
  if (Array.isArray(formulas) && Array.isArray(matrix)) {
    applyAverageSelectionFromSaved(formulas, matrix);
  }

  if (isRatiosTabVisible()) renderRatioTable();
  if (isResultsTabVisible()) renderResultsTable();

  window.parent.postMessage({ type: "arcrho:status", text: `Template loaded: ${filePath}` }, "*");
}
