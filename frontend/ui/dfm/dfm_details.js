/*
===============================================================================
DFM Details Tab - method name, project selection, path bar, threshold reset
===============================================================================
*/
import {
  getDfmInst,
  getDefaultMethodName,
  markDfmDirty,
} from "/ui/dfm/dfm_state.js";
import { resetRatioChartThresholds } from "/ui/dfm/dfm_ratios_tab.js";
import {
  scheduleRatioSelectionLoad,
} from "/ui/dfm/dfm_persistence.js";
import { openDatasetNamePicker } from "/ui/dataset/dataset_name_picker.js";
import { openLazyReservingClassPicker } from "/ui/shared/reserving_class_lazy_picker.js";

const outputTypeNamesByProject = new Map();
const triangleInputNamesByProject = new Map();
let outputTypeRequestSeq = 0;
let triangleInputRequestSeq = 0;
let pendingOutputTypeFromUrl = null;

function toText(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return toText(value).toLowerCase();
}

function parseCalculatedFlag(value) {
  if (typeof value === "boolean") return value;
  const text = normalizeKey(value);
  return text === "true" || text === "1" || text === "yes" || text === "y";
}

function getDatasetTypeColumnIndexes(columns) {
  const indexByName = {};
  for (let i = 0; i < columns.length; i += 1) {
    const key = normalizeKey(columns[i]);
    if (!key || indexByName[key] != null) continue;
    indexByName[key] = i;
  }
  return {
    name: indexByName.name,
    dataFormat: indexByName["data format"],
    calculated: indexByName.calculated,
  };
}

function getDatasetTypeCell(row, index, fallbackKeys) {
  if (Array.isArray(row)) {
    if (Number.isInteger(index) && index >= 0) return row[index];
    return "";
  }
  if (row && typeof row === "object") {
    for (const key of fallbackKeys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    }
  }
  return "";
}

function extractOutputTypeNames(data) {
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const indexes = getDatasetTypeColumnIndexes(columns);
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const name = toText(getDatasetTypeCell(row, indexes.name, ["Name", "name"]));
    if (!name) continue;

    const dataFormat = normalizeKey(getDatasetTypeCell(row, indexes.dataFormat, ["Data Format", "dataFormat", "data_format"]));
    if (dataFormat !== "vector") continue;

    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function extractTriangleInputNames(data) {
  const columns = Array.isArray(data?.columns) ? data.columns : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const indexes = getDatasetTypeColumnIndexes(columns);
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const name = toText(getDatasetTypeCell(row, indexes.name, ["Name", "name"]));
    if (!name) continue;

    const dataFormat = normalizeKey(getDatasetTypeCell(row, indexes.dataFormat, ["Data Format", "dataFormat", "data_format"]));
    if (dataFormat !== "triangle") continue;

    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

async function loadOutputTypeNames(projectName, options = {}) {
  const normalizedProject = normalizeKey(projectName);
  if (!normalizedProject) return [];
  if (!options?.forceReload && outputTypeNamesByProject.has(normalizedProject)) {
    return outputTypeNamesByProject.get(normalizedProject);
  }

  const response = await fetch(`/dataset_types?project_name=${encodeURIComponent(projectName)}`);
  if (!response.ok) {
    let detail = "";
    try {
      detail = toText(await response.text());
    } catch {}
    throw new Error(detail || `HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => ({}));
  const names = extractOutputTypeNames(payload?.data || {});
  outputTypeNamesByProject.set(normalizedProject, names);
  return names;
}

async function loadTriangleInputNames(projectName, options = {}) {
  const normalizedProject = normalizeKey(projectName);
  if (!normalizedProject) return [];
  if (!options?.forceReload && triangleInputNamesByProject.has(normalizedProject)) {
    return triangleInputNamesByProject.get(normalizedProject);
  }

  const response = await fetch(`/dataset_types?project_name=${encodeURIComponent(projectName)}`);
  if (!response.ok) {
    let detail = "";
    try {
      detail = toText(await response.text());
    } catch {}
    throw new Error(detail || `HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => ({}));
  const names = extractTriangleInputNames(payload?.data || {});
  triangleInputNamesByProject.set(normalizedProject, names);
  return names;
}

function closeOutputTypeDropdown() {
  const dropdown = document.getElementById("dfmOutputVectorDropdown");
  if (!dropdown) return;
  dropdown.classList.remove("open");
  dropdown.innerHTML = "";
}

function closeTriangleTypeDropdown() {
  const dropdown = document.getElementById("dfmTriTypeDropdown");
  if (!dropdown) return;
  dropdown.classList.remove("open");
  dropdown.innerHTML = "";
}

function postDfmStatus(text, options = {}) {
  try {
    window.parent.postMessage(
      {
        type: "arcrho:status",
        text: String(text || ""),
        ...(options?.tone ? { tone: options.tone } : {}),
      },
      "*",
    );
  } catch {
    // ignore
  }
}

function syncMethodNameToOutputType(value, options = {}) {
  const next = toText(value);
  const methodInput = document.getElementById("dfmMethodName");
  if (!methodInput) return false;
  const changed = toText(methodInput.value) !== next;
  if (changed) methodInput.value = next;
  updateAppTabTitle(next || getDefaultMethodName(), !options?.silent);
  if (changed && !options?.silent) {
    // Name is updated programmatically here, so the normal Name input change/blur
    // pipeline may not fire. Trigger local method lookup explicitly.
    queueMicrotask(() => scheduleRatioSelectionLoad("details-change"));
  }
  return changed;
}

function applyOutputTypeSelection(value, options = {}) {
  const input = document.getElementById("dfmOutputVector");
  if (!input) return;
  const next = toText(value);
  const prev = toText(input.value);
  const outputChanged = next !== prev;
  if (outputChanged) input.value = next;
  const methodChanged = syncMethodNameToOutputType(next, options);
  if (!outputChanged && !methodChanged) return;
  if (options?.silent) return;
  markDfmDirty();
  scheduleRatioSelectionLoad("details-change");
}

function getFilteredOutputTypeNames(names, query) {
  const list = Array.isArray(names) ? names : [];
  const q = normalizeKey(query);
  if (!q) return list;
  return list.filter((name) => normalizeKey(name).includes(q));
}

function renderOutputTypeDropdown(names, options = {}) {
  const dropdown = document.getElementById("dfmOutputVectorDropdown");
  const input = document.getElementById("dfmOutputVector");
  if (!dropdown || !input) return;

  const query = toText(options?.query);
  const filteredNames = getFilteredOutputTypeNames(names, query);
  dropdown.innerHTML = "";
  if (!Array.isArray(names) || names.length === 0) {
    const option = document.createElement("div");
    option.className = "datasetOption";
    option.textContent = "No output vectors found (Vector).";
    option.style.cursor = "default";
    option.style.color = "#666";
    dropdown.appendChild(option);
    dropdown.classList.add("open");
    return;
  }
  if (filteredNames.length === 0) {
    const option = document.createElement("div");
    option.className = "datasetOption";
    option.textContent = "No matching output vectors.";
    option.style.cursor = "default";
    option.style.color = "#666";
    dropdown.appendChild(option);
    dropdown.classList.add("open");
    return;
  }

  const selectedKey = normalizeKey(input.value);
  for (const name of filteredNames) {
    const option = document.createElement("div");
    option.className = "datasetOption";
    option.textContent = name;
    if (normalizeKey(name) === selectedKey) option.classList.add("active");
    option.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    option.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyOutputTypeSelection(name);
      input.dispatchEvent(new CustomEvent("arcrho:output-type-selected", { detail: { value: name } }));
      closeOutputTypeDropdown();
    });
    dropdown.appendChild(option);
  }
  dropdown.classList.add("open");
}

function applyTriangleSelection(value) {
  const input = document.getElementById("triInput");
  if (!input) return;
  const next = toText(value);
  if (!next) return;
  if (toText(input.value) === next) return;
  input.value = next;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderTriangleTypeDropdown(names) {
  const dropdown = document.getElementById("dfmTriTypeDropdown");
  const input = document.getElementById("triInput");
  if (!dropdown || !input) return;

  dropdown.innerHTML = "";
  if (!Array.isArray(names) || names.length === 0) {
    const option = document.createElement("div");
    option.className = "datasetOption";
    option.textContent = "No triangle names found (Triangle).";
    option.style.cursor = "default";
    option.style.color = "#666";
    dropdown.appendChild(option);
    dropdown.classList.add("open");
    return;
  }

  const selectedKey = normalizeKey(input.value);
  for (const name of names) {
    const option = document.createElement("div");
    option.className = "datasetOption";
    option.textContent = name;
    if (normalizeKey(name) === selectedKey) option.classList.add("active");
    option.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    option.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTriangleSelection(name);
      closeTriangleTypeDropdown();
    });
    dropdown.appendChild(option);
  }
  dropdown.classList.add("open");
}

async function syncOutputTypeForCurrentProject(options = {}) {
  const projectName = toText(document.getElementById("projectSelect")?.value);
  const input = document.getElementById("dfmOutputVector");
  if (!input) return;
  const wasFocusedAtStart = document.activeElement === input;
  const valueAtStart = toText(input.value);

  if (!projectName) {
    applyOutputTypeSelection("", { silent: true });
    closeOutputTypeDropdown();
    return;
  }

  const requestSeq = ++outputTypeRequestSeq;
  try {
    const names = await loadOutputTypeNames(projectName, { forceReload: !!options?.forceReload });
    if (requestSeq !== outputTypeRequestSeq) return;
    const allowedKeys = new Set(names.map((name) => normalizeKey(name)));

    const pending = toText(pendingOutputTypeFromUrl);
    if (pending) {
      const matched = names.find((name) => normalizeKey(name) === normalizeKey(pending)) || "";
      applyOutputTypeSelection(matched, { silent: true });
      pendingOutputTypeFromUrl = "";
      return;
    }

    const current = toText(input.value);
    const isActivelyEditing = document.activeElement === input;
    // Avoid clobbering user typing if the async dataset_types response returns
    // while Output Vector is focused/being edited after page refresh.
    if (isActivelyEditing || (wasFocusedAtStart && current !== valueAtStart)) {
      return;
    }
    if (current && !allowedKeys.has(normalizeKey(current))) {
      applyOutputTypeSelection("", { silent: true });
    }
  } catch (err) {
    if (requestSeq !== outputTypeRequestSeq) return;
    console.error("Failed to load output vectors:", err);
  }
}

export function syncOutputTypeFromProject(options = {}) {
  void syncOutputTypeForCurrentProject(options);
}

export function updateAppTabTitle(title, userAction) {
  if (!title) return;
  const inst = getDfmInst();
  window.parent.postMessage({ type: "arcrho:update-active-tab-title", title, inst, userAction: !!userAction }, "*");
}

export function syncMethodNameFromInputs() {
  const input = document.getElementById("dfmMethodName");
  if (!input) return;
  const outputVector = toText(document.getElementById("dfmOutputVector")?.value);
  const current = toText(input.value);
  const next = current || outputVector || "";
  if (input.value !== next) input.value = next;
  updateAppTabTitle(next || getDefaultMethodName());
}

export function updatePathBar() {
  const projectEl = document.getElementById("dfmPathProject");
  const classEl = document.getElementById("dfmPathClass");
  if (!projectEl || !classEl) return;
  const project = document.getElementById("projectSelect")?.value?.trim() || "-";
  const reservingClass = document.getElementById("pathInput")?.value?.trim() || "-";
  projectEl.textContent = project;
  classEl.textContent = reservingClass;
}

export function wireMethodName() {
  const input = document.getElementById("dfmMethodName");
  if (!input || input.dataset.wired === "1") return;
  input.dataset.wired = "1";
  let lastSeenValue = input.value.trim();
  let lastLookupCommittedValue = input.value.trim();

  const commitValue = (options = {}) => {
    const raw = input.value.trim();
    const programmatic = input.dataset.programmatic === "1";
    if (programmatic) delete input.dataset.programmatic;
    const valueChanged = raw !== lastSeenValue;
    const lookupValueChanged = raw !== lastLookupCommittedValue;
    updateAppTabTitle(raw || getDefaultMethodName(), true);
    if (valueChanged) {
      if (!programmatic) markDfmDirty();
      lastSeenValue = raw;
    }
    if (programmatic) {
      lastLookupCommittedValue = raw;
      return;
    }
    if (options?.triggerLoad && lookupValueChanged) {
      lastLookupCommittedValue = raw;
      scheduleRatioSelectionLoad("details-change");
    }
  };

  input.addEventListener("input", () => commitValue({ triggerLoad: false }));
  input.addEventListener("change", () => commitValue({ triggerLoad: true }));
  input.addEventListener("blur", () => commitValue({ triggerLoad: true }));

  const triInput = document.getElementById("triInput");
  const pathInput = document.getElementById("pathInput");
  const projectInput = document.getElementById("projectSelect");
  const originLen = document.getElementById("originLenSelect");
  const devLen = document.getElementById("devLenSelect");
  triInput?.addEventListener("change", syncMethodNameFromInputs);
  triInput?.addEventListener("input", syncMethodNameFromInputs);
  pathInput?.addEventListener("change", syncMethodNameFromInputs);
  originLen?.addEventListener("change", syncMethodNameFromInputs);
  devLen?.addEventListener("change", syncMethodNameFromInputs);

  projectInput?.addEventListener("change", updatePathBar);
  projectInput?.addEventListener("input", updatePathBar);
  pathInput?.addEventListener("change", updatePathBar);
  pathInput?.addEventListener("input", updatePathBar);

  const markDirtyOnChange = () => markDfmDirty();
  triInput?.addEventListener("change", markDirtyOnChange);
  pathInput?.addEventListener("change", markDirtyOnChange);
  projectInput?.addEventListener("change", markDirtyOnChange);
  originLen?.addEventListener("change", markDirtyOnChange);
  devLen?.addEventListener("change", markDirtyOnChange);

  const triggerLoad = () => scheduleRatioSelectionLoad("details-change");
  pathInput?.addEventListener("change", triggerLoad);
  projectInput?.addEventListener("change", triggerLoad);

  wireReservingClassPicker();
  wireOutputTypePicker();
  wireTriangleTypePicker();
  updatePathBar();
}

function setDfmInstanceMissingNoticeVisible(visible) {
  const notice = document.getElementById("dfmInstanceMissingNotice");
  if (!notice) return;
  notice.classList.toggle("show", !!visible);
}

export function wireDfmInstanceCreationNotice() {
  const notice = document.getElementById("dfmInstanceMissingNotice");
  if (!notice || notice.dataset.wired === "1") return;
  notice.dataset.wired = "1";
  setDfmInstanceMissingNoticeVisible(false);
  // Inline "missing instance" notice beside Name is intentionally disabled.
  // New-object guidance is shown in the shell status bar (yellow warning) instead.
}

function wireReservingClassPicker() {
  const pathInput = document.getElementById("pathInput");
  const pathTreeBtn = document.getElementById("pathTreeBtn");
  if (!pathInput || !pathTreeBtn || pathTreeBtn.dataset.wired === "1") return;
  pathTreeBtn.dataset.wired = "1";

  pathTreeBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const projectName = document.getElementById("projectSelect")?.value?.trim() || "";
    await openLazyReservingClassPicker({
      projectName,
      initialPath: pathInput.value || "",
      anchorElement: pathInput || null,
      onProjectMissing: (name) => {
        alert(`Project "${name}" does not exist.`);
      },
      onError: (err) => {
        console.error("Failed to load reserving class tree:", err);
        alert("Error loading reserving class paths.");
      },
      onSelect: (path) => {
        pathInput.value = String(path || "");
        pathInput.dispatchEvent(new Event("input", { bubbles: true }));
        pathInput.dispatchEvent(new Event("change", { bubbles: true }));
      },
    });
  });
}

function wireOutputTypePicker() {
  const input = document.getElementById("dfmOutputVector");
  const button = document.getElementById("dfmOutputVectorBtn");
  const dropdown = document.getElementById("dfmOutputVectorDropdown");
  if (!input || !button || !dropdown || button.dataset.wired === "1") return;
  button.dataset.wired = "1";
  input.readOnly = false;

  if (pendingOutputTypeFromUrl == null) {
    const query = new URLSearchParams(window.location.search);
    pendingOutputTypeFromUrl = toText(query.get("output_type"));
  }

  let pickerProjectKey = "";
  let pickerNames = [];
  let pickerLoaded = false;
  let committedOutputType = toText(input.value);

  const resetPickerCache = () => {
    pickerProjectKey = "";
    pickerNames = [];
    pickerLoaded = false;
  };

  const ensurePickerNames = async (options = {}) => {
    const projectName = toText(document.getElementById("projectSelect")?.value);
    if (!projectName) {
      resetPickerCache();
      return { projectName: "", names: [] };
    }
    const projectKey = normalizeKey(projectName);
    const forceReload = !!options?.forceReload;
    const projectChanged = projectKey !== pickerProjectKey;
    if (forceReload || projectChanged || !pickerLoaded) {
      const requestSeq = ++outputTypeRequestSeq;
      const names = await loadOutputTypeNames(projectName, {
        forceReload: forceReload || projectChanged,
      });
      if (requestSeq !== outputTypeRequestSeq) return null;
      pickerProjectKey = projectKey;
      pickerNames = Array.isArray(names) ? names : [];
      pickerLoaded = true;
    }
    return { projectName, names: pickerNames };
  };

  const openPicker = async (options = {}) => {
    const projectName = toText(document.getElementById("projectSelect")?.value);
    if (!projectName) {
      closeOutputTypeDropdown();
      if (options?.alertOnProjectMissing) alert("Select a project first.");
      return;
    }
    button.disabled = true;
    try {
      const out = await ensurePickerNames({ forceReload: !!options?.forceReload });
      if (!out) return;
      renderOutputTypeDropdown(out.names, { query: input.value });
    } catch (err) {
      console.error("Failed to load output vector options:", err);
      alert(`Error loading output vectors: ${err?.message || err}`);
    } finally {
      button.disabled = false;
    }
  };

  const commitTypedOutputTypeIfNeeded = async () => {
    const out = await ensurePickerNames({ forceReload: false });
    if (!out) return;
    const typed = toText(input.value);
    if (!typed) {
      if (committedOutputType) applyOutputTypeSelection("");
      committedOutputType = "";
      return;
    }
    const exact = out.names.find((name) => normalizeKey(name) === normalizeKey(typed));
    if (exact) {
      if (normalizeKey(exact) !== normalizeKey(committedOutputType)) {
        applyOutputTypeSelection(exact);
      } else if (toText(input.value) !== exact) {
        input.value = exact;
      }
      committedOutputType = exact;
      return;
    }
    input.value = committedOutputType;
  };

  const openWindowPicker = async () => {
    const projectName = toText(document.getElementById("projectSelect")?.value);
    closeOutputTypeDropdown();
    const out = await openDatasetNamePicker({
      projectName,
      initialName: input.value,
      anchorElement: input,
      title: "Select Output Vector",
      allowedDataFormats: ["Vector"],
      includeCalculated: true,
      emptyMessage: "No Vector dataset names found.",
      setStatus: (msg) => postDfmStatus(msg, { tone: "warn" }),
      onError: (err) => {
        console.error("Failed to open output-vector picker:", err);
        postDfmStatus(`Error loading output vectors: ${String(err?.message || err)}`, { tone: "error" });
      },
      onSelect: (name) => {
        const selected = toText(name);
        if (!selected) return;
        applyOutputTypeSelection(selected);
        input.dispatchEvent(new CustomEvent("arcrho:output-type-selected", { detail: { value: selected } }));
      },
    });
    if (out?.ok) {
      try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
    }
  };

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void openWindowPicker();
  });

  input.addEventListener("click", (e) => {
    e.stopPropagation();
    void openPicker({ forceReload: false, alertOnProjectMissing: false });
  });

  input.addEventListener("focus", () => {
    committedOutputType = toText(input.value);
    void openPicker({ forceReload: false, alertOnProjectMissing: false });
  });

  input.addEventListener("input", () => {
    void openPicker({ forceReload: false, alertOnProjectMissing: false });
  });

  input.addEventListener("change", () => {
    void commitTypedOutputTypeIfNeeded();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!dropdown.contains(document.activeElement) && !button.contains(document.activeElement)) {
        void commitTypedOutputTypeIfNeeded();
        closeOutputTypeDropdown();
      }
    }, 0);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeOutputTypeDropdown();
      return;
    }
    if (e.key === "ArrowDown" && !dropdown.classList.contains("open")) {
      e.preventDefault();
      void openPicker({ forceReload: false, alertOnProjectMissing: false });
      return;
    }
    if (e.key === "Enter" && dropdown.classList.contains("open")) {
      const first = dropdown.querySelector(".datasetOption");
      const text = toText(first?.textContent);
      if (text && text !== "No output vectors found (Vector)." && text !== "No matching output vectors.") {
        e.preventDefault();
        applyOutputTypeSelection(text);
        closeOutputTypeDropdown();
      }
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!dropdown.classList.contains("open")) return;
    const target = e.target;
    if (dropdown.contains(target) || button.contains(target) || input.contains(target)) return;
    closeOutputTypeDropdown();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOutputTypeDropdown();
  }, true);

  const projectInput = document.getElementById("projectSelect");
  projectInput?.addEventListener("change", () => {
    resetPickerCache();
    committedOutputType = toText(input.value);
    closeOutputTypeDropdown();
    void syncOutputTypeForCurrentProject({ forceReload: true });
  });
  projectInput?.addEventListener("input", () => {
    resetPickerCache();
    closeOutputTypeDropdown();
  });

  input.addEventListener("arcrho:output-type-selected", () => {
    committedOutputType = toText(input.value);
  });

  void syncOutputTypeForCurrentProject();
}

function wireTriangleTypePicker() {
  const triInput = document.getElementById("triInput");
  const button = document.getElementById("dfmTriTypeBtn");
  const dropdown = document.getElementById("dfmTriTypeDropdown");
  if (!triInput || !button || !dropdown || button.dataset.wired === "1") return;
  button.dataset.wired = "1";

  const openPicker = async () => {
    const projectName = toText(document.getElementById("projectSelect")?.value);
    closeTriangleTypeDropdown();
    const nativeDatasetDropdown = document.getElementById("datasetDropdown");
    nativeDatasetDropdown?.classList.remove("open");
    await openDatasetNamePicker({
      projectName,
      initialName: triInput.value,
      anchorElement: triInput,
      title: "Select Input Triangle",
      allowedDataFormats: ["Triangle"],
      includeCalculated: true,
      emptyMessage: "No Triangle dataset names found.",
      setStatus: (msg) => postDfmStatus(msg, { tone: "warn" }),
      onError: (err) => {
        console.error("Failed to open input-triangle picker:", err);
        postDfmStatus(`Error loading triangle names: ${String(err?.message || err)}`, { tone: "error" });
      },
      onSelect: (name) => {
        applyTriangleSelection(name);
      },
    });
  };

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void openPicker();
  });

  document.addEventListener("mousedown", (e) => {
    if (!dropdown.classList.contains("open")) return;
    const target = e.target;
    if (dropdown.contains(target) || button.contains(target)) return;
    closeTriangleTypeDropdown();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTriangleTypeDropdown();
  }, true);

  const projectInput = document.getElementById("projectSelect");
  projectInput?.addEventListener("change", closeTriangleTypeDropdown);
  projectInput?.addEventListener("input", closeTriangleTypeDropdown);
}

export function wireDetailsThresholdReset() {
  const detailsPage = document.getElementById("dfmDetailsPage");
  if (!detailsPage || detailsPage.dataset.thresholdWired === "1") return;
  detailsPage.dataset.thresholdWired = "1";
  const handleChange = () => {
    resetRatioChartThresholds();
  };
  detailsPage.addEventListener("input", handleChange, { capture: true });
  detailsPage.addEventListener("change", handleChange, { capture: true });
}
