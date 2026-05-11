import { getHostApi, registerShellApi } from "./shell_context.js?v=20260510a";
import { ensureActiveTabInvariant, getFirstDockedTabId, loadState, saveState, state } from "./shell_state.js?v=20260510a";
import { applyAppFont, applyZoom, adjustZoomByDelta, broadcastAppFont, broadcastZoomToIframes, closeFontSettingsModal, closeForceRebuildSettingsModal, getAutoSaveEnabled, getForceRebuildEnabled, getZoomPercent, hideGlobalTooltip, hostZoomAvailable, initAutoSaveToggle, initFontSettingsModal, initForceRebuildSettingsModal, initShellPreferences, initZoomControls, loadAppFont, openFontSettingsModal, openForceRebuildSettingsModal, setAutoSaveEnabled, setForceRebuildEnabled, setZoomPercent, showGlobalTooltip, ZOOM_STEP } from "./shell_preferences.js?v=20260510a";
import { clearSavedStatusOnDirty, formatStatusTimestamp, getStatusBarHeight, initClock, updateStatusBar } from "./status_bar.js?v=20260510a";
import { closeRootPathSettingsModal, initRootPathSettingsModal, openRootPathSettingsModal } from "./root_path_settings.js?v=20260510a";
import { clearCacheAndReload, customHardRefresh, initAppLifecycle, refreshActiveTab, restartApplication, sendShutdownSignal, showAppConfirm, shutdownApplication } from "./app_lifecycle.js?v=20260510a";
import { clearTestData, getLastWorkflowDir, getLastWorkflowPath, getWorkflowTabState, importWorkflow, postToWorkflowTab, setLastWorkflowPath } from "./workflow_host_actions.js?v=20260510a";
import { closeTab, closeTabsExcept, dockTab, floatTab, openBrowsingHistoryTab, openDatasetTab, openDFMTab, openProjectSettingsTab, openScriptingTab, openWorkflowTab, setActive, setDockedActive } from "./tab_actions.js?v=20260510a";
import { applyDockedIframeLayout, clampFloatingTabsToContent, clampFloatRect, defaultFloatRectFromPointer, ensureContentContainers, ensureIframe, notifyBrowsingHistoryTabs, notifyServerConnectionUpdated, notifyTabActivated, printActiveTab, removeFloatPreview, renderContent, renderFloatingWindows, updateFloatPreview } from "./shell_content.js?v=20260510a";
import { closeTabCtxMenu, initTabStrip, isTabStripDragging, renderTabs, togglePlusMenu } from "./tab_strip.js?v=20260510a";
import { closeAllShellMenus, initShellMenus, isActiveDFMDetailsTab, isActiveDFMTab, isActiveProjectSettingsDatasetTypesTab, isActiveProjectSettingsReservingClassTypesTab, isActiveScriptingTab, isActiveWorkflowTab, sendDFMCommand, sendProjectSettingsCommand, sendScriptingCommand, sendWorkflowCommand, setDfmEditEnabled, toggleNavigationPanel, updateEditMenuState, updateFileMenuState, updateViewMenuState } from "./shell_menus.js?v=20260510a";
import { initHotkeys, runHotkeyAction } from "./shell_hotkeys.js?v=20260510a";
import { initShellMessages } from "./shell_messages.js?v=20260510a";
import { initResizeHandle, initTitlebarControls } from "./titlebar_controls.js?v=20260510a";
import { initAiAssistant } from "./ai_assistant.js?v=20260510a";

const UI_VERSION_PARAM = new URLSearchParams(window.location.search).get("v") || String(Date.now());

function render() {
  if (isTabStripDragging()) return;
  renderTabs();
  renderContent();
  updateFileMenuState();
  updateEditMenuState();
  updateViewMenuState();
  saveState();
}

function wire() {
  initZoomControls();
  initAutoSaveToggle();
  initFontSettingsModal();
  initRootPathSettingsModal();
  initForceRebuildSettingsModal();
  initShellMenus();
  initTabStrip();
  initShellMessages();
  initHotkeys();
  initAppLifecycle();
  initAiAssistant();
}

registerShellApi({
  ZOOM_STEP,
  adjustZoomByDelta,
  applyAppFont,
  applyDockedIframeLayout,
  applyZoom,
  broadcastAppFont,
  broadcastZoomToIframes,
  clampFloatingTabsToContent,
  clampFloatRect,
  clearCacheAndReload,
  clearSavedStatusOnDirty,
  clearTestData,
  closeAllShellMenus,
  closeFontSettingsModal,
  closeForceRebuildSettingsModal,
  closeRootPathSettingsModal,
  closeTab,
  closeTabCtxMenu,
  closeTabsExcept,
  customHardRefresh,
  defaultFloatRectFromPointer,
  dockTab,
  ensureActiveTabInvariant,
  ensureContentContainers,
  ensureIframe,
  floatTab,
  formatStatusTimestamp,
  getAutoSaveEnabled,
  getFirstDockedTabId,
  getForceRebuildEnabled,
  getHostApi,
  getLastWorkflowDir,
  getLastWorkflowPath,
  getStatusBarHeight,
  getWorkflowTabState,
  getZoomPercent,
  hideGlobalTooltip,
  hostZoomAvailable,
  importWorkflow,
  isActiveDFMDetailsTab,
  isActiveDFMTab,
  isActiveProjectSettingsDatasetTypesTab,
  isActiveProjectSettingsReservingClassTypesTab,
  isActiveScriptingTab,
  isActiveWorkflowTab,
  loadAppFont,
  loadState,
  notifyBrowsingHistoryTabs,
  notifyServerConnectionUpdated,
  notifyTabActivated,
  openBrowsingHistoryTab,
  openDatasetTab,
  openDFMTab,
  openFontSettingsModal,
  openForceRebuildSettingsModal,
  openProjectSettingsTab,
  openRootPathSettingsModal,
  openScriptingTab,
  openWorkflowTab,
  postToWorkflowTab,
  printActiveTab,
  refreshActiveTab,
  removeFloatPreview,
  render,
  renderContent,
  renderFloatingWindows,
  renderTabs,
  restartApplication,
  runHotkeyAction,
  saveState,
  sendDFMCommand,
  sendProjectSettingsCommand,
  sendScriptingCommand,
  sendShutdownSignal,
  sendWorkflowCommand,
  setActive,
  setAutoSaveEnabled,
  setDfmEditEnabled,
  setDockedActive,
  setForceRebuildEnabled,
  setLastWorkflowPath,
  setZoomPercent,
  showAppConfirm,
  showGlobalTooltip,
  shutdownApplication,
  state,
  toggleNavigationPanel,
  togglePlusMenu,
  uiVersionParam: UI_VERSION_PARAM,
  updateEditMenuState,
  updateFileMenuState,
  updateFloatPreview,
  updateStatusBar,
  updateViewMenuState,
});

initShellPreferences();
loadState();
ensureContentContainers();
wire();
render();

if (getHostApi()) initTitlebarControls();
window.addEventListener("adaHostReady", () => initTitlebarControls());
if (getHostApi()) initResizeHandle();
window.addEventListener("adaHostReady", () => initResizeHandle());
initClock();
