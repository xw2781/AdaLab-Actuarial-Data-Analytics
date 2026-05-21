import { getHostApi, registerShellApi } from "./shell_context.js?v=20260510a";
import { ensureActiveTabInvariant, getFirstDockedTabId, loadState, saveState, state } from "./shell_state.js?v=20260520a";
import { applyAppFont, applyZoom, adjustZoomByDelta, broadcastAppFont, broadcastZoomToIframes, closeFontSettingsModal, closeForceRebuildSettingsModal, getAutoSaveEnabled, getForceRebuildEnabled, getZoomPercent, hideGlobalTooltip, hostZoomAvailable, initAutoSaveToggle, initFontSettingsModal, initForceRebuildSettingsModal, initShellPreferences, initZoomControls, loadAppFont, openFontSettingsModal, openForceRebuildSettingsModal, setAutoSaveEnabled, setForceRebuildEnabled, setZoomPercent, showGlobalTooltip, ZOOM_STEP } from "./shell_preferences.js?v=20260510a";
import { clearSavedStatusOnDirty, formatStatusTimestamp, getStatusBarHeight, initClock, updateStatusBar } from "./status_bar.js?v=20260510a";
import { closeRootPathSettingsModal, initRootPathSettingsModal, openRootPathSettingsModal } from "./root_path_settings.js?v=20260510a";
import { clearCacheAndReload, customHardRefresh, initAppLifecycle, refreshActiveTab, restartApplication, sendShutdownSignal, showAppConfirm, shutdownApplication } from "./app_lifecycle.js?v=20260510a";
import { clearTestData, getLastWorkflowDir, getLastWorkflowPath, getWorkflowTabState, importWorkflow, postToWorkflowTab, setLastWorkflowPath } from "./workflow_host_actions.js?v=20260510a";
import { closeTab, closeTabsExcept, dockTab, floatTab, openAgentGuideTab, openBrowsingHistoryTab, openDatasetTab, openDFMTab, openProjectInstanceTab, openProjectSettingsTab, openScriptingTab, openWorkflowTab, setActive, setDockedActive } from "./tab_actions.js?v=20260520a";
import { applyDockedIframeLayout, clampFloatingTabsToContent, clampFloatRect, defaultFloatRectFromPointer, ensureContentContainers, ensureIframe, notifyBrowsingHistoryTabs, notifyServerConnectionUpdated, notifyTabActivated, printActiveTab, removeFloatPreview, renderContent, renderFloatingWindows, updateFloatPreview } from "./shell_content.js?v=20260520c";
import { closeTabCtxMenu, initTabStrip, isTabStripDragging, openTabCtxMenu, renderTabs, togglePlusMenu } from "./tab_strip.js?v=20260520b";
import { closeAllShellMenus, initShellMenus, isActiveDFMDetailsTab, isActiveDFMTab, isActiveProjectSettingsDatasetTypesTab, isActiveProjectSettingsReservingClassTypesTab, isActiveScriptingTab, isActiveWorkflowTab, sendDFMCommand, sendProjectSettingsCommand, sendScriptingCommand, sendWorkflowCommand, setDfmEditEnabled, toggleNavigationPanel, updateEditMenuState, updateFileMenuState, updateHelpMenuState, updateViewMenuState } from "./shell_menus.js?v=20260520b";
import { initHotkeys, runHotkeyAction } from "./shell_hotkeys.js?v=20260517a";
import { initShellMessages } from "./shell_messages.js?v=20260520b";
import { handleShellFileDragOver, handleShellFileDrop, initShellFileDrops } from "./shell_file_drop.js?v=20260519a";
import { initTitlebarControls } from "./titlebar_controls.js?v=20260517a";
import { initAiAssistant } from "./ai_assistant.js?v=20260515b";
import { closeMacroWindow, initMacroWindow, openMacroWindow } from "./shell_macros.js?v=20260520c";

const UI_VERSION_PARAM = new URLSearchParams(window.location.search).get("v") || String(Date.now());

function render() {
  if (isTabStripDragging()) return;
  renderTabs();
  renderContent();
  updateFileMenuState();
  updateEditMenuState();
  updateViewMenuState();
  updateHelpMenuState();
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
  initShellFileDrops();
  initHotkeys();
  initAppLifecycle();
  initAiAssistant();
  initMacroWindow();
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
  closeMacroWindow,
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
  handleShellFileDragOver,
  handleShellFileDrop,
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
  openAgentGuideTab,
  openDatasetTab,
  openDFMTab,
  openFontSettingsModal,
  openForceRebuildSettingsModal,
  openMacroWindow,
  openProjectSettingsTab,
  openProjectInstanceTab,
  openRootPathSettingsModal,
  openTabCtxMenu,
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
  updateHelpMenuState,
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
initClock();
