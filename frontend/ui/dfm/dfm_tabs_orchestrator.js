/*
===============================================================================
DFM Tabs - Orchestrator
Initializes all DFM tabs, wires event handlers, and coordinates modules.
===============================================================================
*/
import { createTabbedPage } from "/ui/shared/tabbed_page.js";
import { setStorageInstance, loadNaBorders } from "/ui/dfm/dfm_storage.js";
import {
  getDfmInst,
  ALLOWED_DFM_TABS,
  setShowNaBorders,
  setCachedRootPath,
  setCurrentDfmTab,
  getCurrentDfmTab,
  getDfmIsDirty,
  isRatiosTabVisible,
  isResultsTabVisible,
  markDfmClean,
  notifyDfmEditState,
  buildRatioSavePath,
} from "/ui/dfm/dfm_state.js";
import {
  renderRatioTable,
  wireRatioStrikeToggle,
  wireRatioChartModal,
  wireRatioContextMenu,
  wireDfmSpinnerControls,
  excludeExtremeInActiveCol,
  includeAllInActiveCol,
  isRatioChartOpen,
  scheduleRatioChartRender,
} from "/ui/dfm/dfm_ratios_tab.js";
import {
  renderResultsTable,
  wireResultsRatioBasisControls,
} from "/ui/dfm/dfm_results_tab.js";
import { wireNotesInput } from "/ui/dfm/dfm_notes_tab.js";
import {
  syncMethodNameFromInputs,
  syncOutputTypeFromProject,
  updatePathBar,
  wireMethodName,
  wireDfmInstanceCreationNotice,
  wireDetailsThresholdReset,
} from "/ui/dfm/dfm_details.js";
import {
  scheduleRatioSelectionLoad,
  saveRatioSelectionPattern,
  saveDfmTemplate,
  loadDfmTemplate,
  buildDfmAssistantContextPayload,
} from "/ui/dfm/dfm_persistence.js?v=20260513e";
import { wireRatioSyncChannel, requestRatioStateSync } from "/ui/dfm/dfm_sync.js";
import { wireDfmRpcBridgePathBar } from "/ui/dfm/dfm_rpc_bridge_pathbar.js?v=20260513d";
import { openDfmStartupChooser } from "/ui/dfm/dfm_startup_dialog.js?v=20260513e";

function handleDatasetUpdated() {
  if (isRatiosTabVisible()) renderRatioTable();
  if (isResultsTabVisible()) renderResultsTable();
  syncMethodNameFromInputs();
  syncOutputTypeFromProject();
  updatePathBar();
  scheduleRatioSelectionLoad("dataset-updated");
  if (isRatioChartOpen()) scheduleRatioChartRender();
}

async function buildAssistantContext() {
  let methodPath = "";
  let pathError = "";
  let activeJson = null;
  let activeJsonError = "";
  try {
    methodPath = await buildRatioSavePath();
  } catch (err) {
    pathError = String(err?.message || err || "Could not resolve DFM method path.");
  }
  try {
    activeJson = await buildDfmAssistantContextPayload({ persistSummaryOrder: false });
  } catch (err) {
    activeJsonError = String(err?.message || err || "Could not build active DFM method payload.");
  }
  return {
    available: true,
    pageType: "dfm",
    activeDfmTab: getCurrentDfmTab(),
    methodPath,
    pathError,
    activeJson,
    activeJsonSource: activeJson ? "dfm-ui-state" : "",
    activeJsonError,
    dirty: getDfmIsDirty(),
    fields: {
      project: document.getElementById("projectSelect")?.value?.trim() || "",
      reservingClass: document.getElementById("pathInput")?.value?.trim() || "",
      methodName: document.getElementById("dfmMethodName")?.value?.trim() || "",
      outputVector: document.getElementById("dfmOutputVector")?.value?.trim() || "",
      inputTriangle: document.getElementById("triInput")?.value?.trim() || "",
      originLength: document.getElementById("originLenSelect")?.value?.trim() || "",
      developmentLength: document.getElementById("devLenSelect")?.value?.trim() || "",
    },
  };
}

function initDfmTabs() {
  const detailsPage = document.getElementById("dfmDetailsPage");
  const dataPage = document.getElementById("dfmDataPage");
  const ratiosPage = document.getElementById("dfmRatiosPage");
  const resultsPage = document.getElementById("dfmResultsPage");
  const notesPage = document.getElementById("dfmNotesPage");
  if (!detailsPage || !dataPage || !ratiosPage || !resultsPage || !notesPage) return;

  setShowNaBorders(loadNaBorders());

  wireDfmSpinnerControls();
  wireMethodName();
  wireDfmInstanceCreationNotice();
  wireNotesInput();
  wireDetailsThresholdReset();
  wireRatioStrikeToggle();
  wireRatioChartModal();
  wireRatioContextMenu();
  wireResultsRatioBasisControls();

  const params = new URLSearchParams(window.location.search);
  const urlTab = params.get("tab");
  const initialTab = ALLOWED_DFM_TABS.has(urlTab) ? urlTab : "details";

  const tabSystem = createTabbedPage(document.body, {
    tabs: [
      { id: "details", label: "Details" },
      { id: "data", label: "Data" },
      { id: "ratios", label: "Ratios" },
      { id: "results", label: "Results" },
      { id: "notes", label: "Notes" }
    ],
    cssPrefix: "dfm",
    initialTab,
    injectTabBar: false,
    onTabChange: (tabId) => {
      setCurrentDfmTab(tabId);
      if (tabId === "ratios") renderRatioTable();
      if (tabId === "results") renderResultsTable();
      notifyDfmEditState();
      if (tabId === "details") {
        syncMethodNameFromInputs();
        syncOutputTypeFromProject();
      }
      const inst = getDfmInst();
      window.parent.postMessage({ type: "arcrho:dfm-tab-changed", inst, tab: tabId }, "*");
    }
  });

  window.dfmTabSystem = tabSystem;
}

export function initDfmRatios() {
  setStorageInstance(getDfmInst());
  initDfmTabs();
  notifyDfmEditState();
  syncMethodNameFromInputs();
  syncOutputTypeFromProject();
  updatePathBar();
  wireDfmRpcBridgePathBar();
  setTimeout(() => {
    syncOutputTypeFromProject();
    updatePathBar();
  }, 500);

  document.getElementById("loadDfmSettingsBtn")?.addEventListener("click", () => loadDfmTemplate());
  window.addEventListener("arcrho:workflow-defaults-updated", () => {
    syncMethodNameFromInputs();
    syncOutputTypeFromProject();
    updatePathBar();
  });
  wireRatioSyncChannel();
  requestRatioStateSync();

  window.addEventListener("arcrho:dataset-updated", handleDatasetUpdated);

  /* ---- Apply project/class from URL params when embedded in workflow ---- */
  const _qs = new URLSearchParams(window.location.search);
  const _urlProject = _qs.get("project") || "";
  const _urlClass = _qs.get("class") || "";
  if (_urlProject || _urlClass) {
    const projEl = document.getElementById("projectSelect");
    const classEl = document.getElementById("pathInput");
    if (_urlProject && projEl) projEl.value = _urlProject;
    if (_urlClass && classEl) classEl.value = _urlClass;
    syncMethodNameFromInputs();
    syncOutputTypeFromProject({ forceReload: true });
    updatePathBar();
  }

  setTimeout(() => {
    void openDfmStartupChooser({
      onLoad: () => {
        syncMethodNameFromInputs();
        updatePathBar();
        scheduleRatioSelectionLoad("startup");
      },
      onNew: () => {
        syncMethodNameFromInputs();
        updatePathBar();
        markDfmClean();
        window.parent.postMessage({ type: "arcrho:status", text: "Ready: New DFM object." }, "*");
      },
    });
  }, 100);

  window.addEventListener("message", (e) => {
    /* Respond to workflow requesting DFM step settings for snapshot */
    if (e?.data?.type === "arcrho:get-dfm-settings") {
      const settings = {
        project: document.getElementById("projectSelect")?.value?.trim() || "",
        reservingClass: document.getElementById("pathInput")?.value?.trim() || "",
        objectName: document.getElementById("dfmMethodName")?.value?.trim() || "",
        outputType: document.getElementById("dfmOutputType")?.value?.trim() || "",
        originLen: document.getElementById("originLenSelect")?.value?.trim() || "",
        devLen: document.getElementById("devLenSelect")?.value?.trim() || "",
      };
      window.parent.postMessage({ type: "arcrho:dfm-settings", settings, requestId: e.data.requestId }, "*");
      return;
    }
    /* Handle global control changes from workflow */
    if (e?.data?.type === "arcrho:workflow-global-changed") {
      const vars = e.data.globalControl?.vars || [];
      const proj = vars.find(v => v.key === "project")?.value || "";
      const rc = vars.find(v => v.key === "reservingClass")?.value || "";
      const projectInput = document.getElementById("projectSelect");
      const pathInput = document.getElementById("pathInput");
      if (proj && projectInput) projectInput.value = proj;
      if (rc && pathInput) pathInput.value = rc;
      syncMethodNameFromInputs();
      syncOutputTypeFromProject({ forceReload: true });
      updatePathBar();
      scheduleRatioSelectionLoad("global-changed");
      return;
    }
    if (e?.data?.type === "arcrho:server-connection-updated") {
      setCachedRootPath(e.data.config?.workspace_root || "");
      window.parent.postMessage({ type: "arcrho:status", text: "Server connection updated." }, "*");
      return;
    }
    if (e?.data?.type === "arcrho:assistant-context-request") {
      const requestId = e.data.requestId || "";
      buildAssistantContext()
        .then((context) => {
          window.parent.postMessage({ type: "arcrho:assistant-context-result", requestId, context }, "*");
        })
        .catch((err) => {
          window.parent.postMessage({
            type: "arcrho:assistant-context-result",
            requestId,
            context: {
              available: false,
              pageType: "dfm",
              error: String(err?.message || err || "DFM assistant context failed."),
            },
          }, "*");
        });
      return;
    }
    if (e?.data?.type === "arcrho:assistant-json-updated") {
      scheduleRatioSelectionLoad("assistant-edit");
      return;
    }
    if (e?.data?.type === "arcrho:dfm-request-state" || e?.data?.type === "arcrho:dfm-tab-activated") {
      notifyDfmEditState();
      return;
    }
    if (e?.data?.type === "arcrho:dfm-exclude-high") {
      const ratiosPage = document.getElementById("dfmRatiosPage");
      if (!ratiosPage || ratiosPage.style.display === "none") return;
      excludeExtremeInActiveCol("high");
      return;
    }
    if (e?.data?.type === "arcrho:dfm-exclude-low") {
      const ratiosPage = document.getElementById("dfmRatiosPage");
      if (!ratiosPage || ratiosPage.style.display === "none") return;
      excludeExtremeInActiveCol("low");
      return;
    }
    if (e?.data?.type === "arcrho:dfm-include-all") {
      const ratiosPage = document.getElementById("dfmRatiosPage");
      if (!ratiosPage || ratiosPage.style.display === "none") return;
      includeAllInActiveCol();
      return;
    }
    if (e?.data?.type === "arcrho:dfm-save") {
      saveRatioSelectionPattern(false);
      return;
    }
    if (e?.data?.type === "arcrho:dfm-save-as") {
      saveRatioSelectionPattern(true);
      return;
    }
    if (e?.data?.type === "arcrho:dfm-save-template") {
      saveDfmTemplate();
      return;
    }
  });

  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const key = (e.key || "").toLowerCase();
    if (key !== "h" && key !== "l" && key !== "i") return;
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
    const ratiosPage = document.getElementById("dfmRatiosPage");
    if (!ratiosPage || ratiosPage.style.display === "none") return;
    e.preventDefault();
    if (key === "h") excludeExtremeInActiveCol("high");
    if (key === "l") excludeExtremeInActiveCol("low");
    if (key === "i") includeAllInActiveCol();
  }, { capture: true });
}
