import { shell } from "./shell_context.js?v=20260510a";
import { isAiAssistantLauncherVisible, toggleAiAssistantLauncherVisible } from "./ai_assistant.js?v=20260515a";

const fileMenuBtn = document.querySelector('.menu[data-menu="file"]');
const fileMenuDropdown = document.getElementById("fileMenuDropdown");
const editMenuBtn = document.querySelector('.menu[data-menu="edit"]');
const editMenuDropdown = document.getElementById("editMenuDropdown");
const viewMenuBtn = document.querySelector('.menu[data-menu="view"]');
const viewMenuDropdown = document.getElementById("viewMenuDropdown");
const settingsMenuBtn = document.querySelector('.menu[data-menu="settings"]');
const settingsMenuDropdown = document.getElementById("settingsMenuDropdown");
const menuBarEl = document.getElementById("menubar");
const aboutOverlay = document.getElementById("aboutOverlay");
const aboutCloseBtn = document.getElementById("aboutCloseBtn");
let dfmEditEnabled = false;
let shellMenusWired = false;

function positionDropdown(btn, dropdown) {
  if (!btn || !dropdown) return;
  const r = btn.getBoundingClientRect();
  dropdown.style.left = `${Math.round(r.left)}px`;
  dropdown.style.top = `${Math.round(r.bottom + 6)}px`;
}
function toggleDropdown(btn, dropdown, forceOpen) {
  if (!dropdown) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !dropdown.classList.contains("open");
  dropdown.classList.toggle("open", shouldOpen);
  if (shouldOpen) positionDropdown(btn, dropdown);
}
function toggleFileMenu(forceOpen) { toggleDropdown(fileMenuBtn, fileMenuDropdown, forceOpen); }
function toggleEditMenu(forceOpen) { toggleDropdown(editMenuBtn, editMenuDropdown, forceOpen); }
function toggleViewMenu(forceOpen) { toggleDropdown(viewMenuBtn, viewMenuDropdown, forceOpen); }
function toggleSettingsMenu(forceOpen) { toggleDropdown(settingsMenuBtn, settingsMenuDropdown, forceOpen); }

const shellMenuToggles = { file: toggleFileMenu, edit: toggleEditMenu, view: toggleViewMenu, settings: toggleSettingsMenu };
const shellMenuDropdowns = { file: fileMenuDropdown, edit: editMenuDropdown, view: viewMenuDropdown, settings: settingsMenuDropdown };

function openShellMenu(type, forceOpen) {
  const toggle = shellMenuToggles[type];
  const dropdown = shellMenuDropdowns[type];
  if (!toggle || !dropdown) return;
  if (type === "file") updateFileMenuState();
  if (type === "edit") updateEditMenuState();
  if (type === "view") updateViewMenuState();
  const isOpen = dropdown.classList.contains("open");
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !isOpen;
  closeAllShellMenus();
  if (shouldOpen && !hasVisibleMenuItems(dropdown)) return;
  if (shouldOpen) toggle(true);
}

export function closeAllShellMenus() {
  toggleFileMenu(false);
  toggleEditMenu(false);
  toggleViewMenu(false);
  toggleSettingsMenu(false);
  shell.togglePlusMenu?.(false);
  shell.closeTabCtxMenu?.();
}

function openAboutDialog() { aboutOverlay?.classList.add("open"); }
function closeAboutDialog() { aboutOverlay?.classList.remove("open"); }
export function setDfmEditEnabled(enabled) { dfmEditEnabled = !!enabled; updateEditMenuState(); }
export function isActiveWorkflowTab() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return !!tab && tab.type === "workflow"; }
export function isActiveDFMTab() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return !!tab && tab.type === "dfm"; }
function getActiveDFMSubTab() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return !tab || tab.type !== "dfm" ? "" : String(tab.dfmTab || "details").trim().toLowerCase(); }
export function isActiveDFMDetailsTab() { return isActiveDFMTab() && getActiveDFMSubTab() === "details"; }
export function isActiveScriptingTab() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return !!tab && tab.type === "scripting"; }
function isActiveProjectSettingsTab() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return !!tab && tab.type === "project_settings"; }
function getActiveProjectSettingsRibbon() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return !tab || tab.type !== "project_settings" ? "" : String(tab.projectSettingsRibbon || "").trim().toLowerCase(); }
export function isActiveProjectSettingsDatasetTypesTab() { return isActiveProjectSettingsTab() && getActiveProjectSettingsRibbon() === "dataset-types"; }
export function isActiveProjectSettingsReservingClassTypesTab() { return isActiveProjectSettingsTab() && getActiveProjectSettingsRibbon() === "reserving-class-types"; }
function getActiveTabType() { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); return String(tab?.type || "").toLowerCase(); }

function parsePageScopes(raw) {
  if (!raw) return null;
  const scopes = String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return scopes.length ? scopes : null;
}
function applyScopedMenuVisibility(dropdown) {
  if (!dropdown) return;
  const activeType = getActiveTabType();
  const requiresScope = dropdown.hasAttribute("data-requires-page-scope");
  dropdown.querySelectorAll(".menuItem").forEach((el) => {
    const scopes = parsePageScopes(el.getAttribute("data-page-scopes"));
    if (!scopes) { el.hidden = requiresScope; return; }
    if (scopes.includes("*")) { el.hidden = false; return; }
    el.hidden = !activeType || !scopes.includes(activeType);
  });
}
function normalizeMenuSeparators(dropdown) {
  if (!dropdown) return;
  const children = Array.from(dropdown.children);
  children.forEach((el) => { if (el.classList.contains("menuSep")) el.hidden = false; });
  children.forEach((el) => {
    if (!el.classList.contains("menuSep")) return;
    let prev = el.previousElementSibling;
    while (prev && prev.hidden) prev = prev.previousElementSibling;
    let next = el.nextElementSibling;
    while (next && next.hidden) next = next.nextElementSibling;
    el.hidden = !(!!prev && prev.classList.contains("menuItem") && !!next && next.classList.contains("menuItem"));
  });
}
function hasVisibleMenuItems(dropdown) { return !!dropdown && Array.from(dropdown.querySelectorAll(".menuItem")).some((el) => !el.hidden); }

function updateFileSaveMenuLabels() {
  if (!fileMenuDropdown) return;
  const saveLabel = fileMenuDropdown.querySelector('.menuItem[data-action="save"] > span:not(.menuShortcut)');
  const saveAsLabel = fileMenuDropdown.querySelector('.menuItem[data-action="save-as"] > span:not(.menuShortcut)');
  const reservingClassTypesMode = isActiveProjectSettingsReservingClassTypesTab();
  const datasetTypesMode = isActiveProjectSettingsDatasetTypesTab();
  if (saveLabel) saveLabel.textContent = reservingClassTypesMode ? "Save Reserving Class Types As..." : datasetTypesMode ? "Save Dataset Types" : "Save";
  if (saveAsLabel) saveAsLabel.textContent = reservingClassTypesMode ? "Load Reserving Class Types From..." : datasetTypesMode ? "Load Dataset Types" : isActiveDFMDetailsTab() ? "Save as Template" : "Save As...";
}

export function updateFileMenuState() {
  if (!fileMenuDropdown) return;
  applyScopedMenuVisibility(fileMenuDropdown);
  updateFileSaveMenuLabels();
  const saveEnabled = isActiveWorkflowTab() || isActiveDFMTab() || isActiveScriptingTab() || isActiveProjectSettingsReservingClassTypesTab() || isActiveProjectSettingsDatasetTypesTab();
  fileMenuDropdown.querySelectorAll(".menuItem").forEach((el) => {
    if (el.hidden) { el.classList.remove("disabled"); return; }
    const action = el.getAttribute("data-action") || "";
    const shouldDisable = (!saveEnabled && (action === "save" || action === "save-as")) || (action === "close-tab" && shell.state.activeId === "home");
    el.classList.toggle("disabled", shouldDisable);
  });
  normalizeMenuSeparators(fileMenuDropdown);
}

export function updateEditMenuState() {
  if (!editMenuDropdown) return;
  applyScopedMenuVisibility(editMenuDropdown);
  const isDfm = isActiveDFMTab();
  const isScripting = isActiveScriptingTab();
  const editEnabled = isDfm && dfmEditEnabled;
  editMenuDropdown.querySelectorAll(".menuItem").forEach((el) => {
    if (el.hidden) { el.classList.remove("disabled"); return; }
    const action = el.getAttribute("data-action") || "";
    const shouldDisable = action === "render-all-markdown" ? !isScripting : action === "dfm-include-all" ? !isDfm : !editEnabled;
    el.classList.toggle("disabled", shouldDisable);
  });
  normalizeMenuSeparators(editMenuDropdown);
}

export function updateViewMenuState() {
  if (!viewMenuDropdown) return;
  applyScopedMenuVisibility(viewMenuDropdown);
  const isWorkflow = isActiveWorkflowTab();
  const isScripting = isActiveScriptingTab();
  const aiBotIconLabel = viewMenuDropdown.querySelector('.menuItem[data-action="toggle-ai-bot-icon"] > span:not(.menuShortcut)');
  if (aiBotIconLabel) aiBotIconLabel.textContent = isAiAssistantLauncherVisible() ? "Hide AI Bot Icon" : "Show AI Bot Icon";
  viewMenuDropdown.querySelectorAll(".menuItem").forEach((el) => {
    if (el.hidden) { el.classList.remove("disabled"); return; }
    const action = el.getAttribute("data-action") || "";
    const shouldDisable = (action === "toggle-nav" && !isWorkflow) || ((action === "toggle-line-numbers" || action === "toggle-exec-time") && !isScripting);
    el.classList.toggle("disabled", shouldDisable);
  });
  normalizeMenuSeparators(viewMenuDropdown);
}

export function sendWorkflowCommand(type) { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); if (!tab || tab.type !== "workflow") return; shell.ensureIframe?.(tab); try { tab.iframe?.contentWindow?.postMessage({ type }, "*"); } catch {} }
export function sendDFMCommand(type) { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); if (!tab || tab.type !== "dfm") return; shell.ensureIframe?.(tab); try { tab.iframe?.contentWindow?.postMessage({ type }, "*"); } catch {} }
export function sendScriptingCommand(type) { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); if (!tab || tab.type !== "scripting") return; shell.ensureIframe?.(tab); try { tab.iframe?.contentWindow?.postMessage({ type }, "*"); } catch {} }
export function sendProjectSettingsCommand(type) { const tab = shell.state.tabs.find(t => t.id === shell.state.activeId); if (!tab || tab.type !== "project_settings") return; shell.ensureIframe?.(tab); try { tab.iframe?.contentWindow?.postMessage({ type }, "*"); } catch {} }
export function toggleNavigationPanel() { sendWorkflowCommand("arcrho:workflow-toggle-nav"); }

export function initShellMenus() {
  if (shellMenusWired) return;
  shellMenusWired = true;
  aboutCloseBtn?.addEventListener("click", closeAboutDialog);
  aboutOverlay?.addEventListener("click", (e) => { if (e.target === aboutOverlay) closeAboutDialog(); });
  menuBarEl?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".menu[data-menu]");
    if (!btn) return;
    const type = btn.getAttribute("data-menu") || "";
    if (type === "about") { closeAllShellMenus(); openAboutDialog(); return; }
    if (!shellMenuToggles[type]) { closeAllShellMenus(); return; }
    e.stopPropagation();
    openShellMenu(type);
  });
  fileMenuDropdown?.addEventListener("click", (e) => {
    const item = e.target?.closest?.(".menuItem");
    const action = item?.getAttribute("data-action");
    if (!action || item.classList.contains("disabled")) return;
    toggleFileMenu(false);
    if (action === "save-workflow") { shell.updateStatusBar?.("Saving..."); sendWorkflowCommand("arcrho:workflow-save"); }
    else if (action === "save-workflow-as") { shell.updateStatusBar?.("Saving as..."); sendWorkflowCommand("arcrho:workflow-save-as"); }
    else if (action === "open-notebook") { shell.updateStatusBar?.("Opening notebook..."); sendScriptingCommand("arcrho:scripting-open"); }
    else if (action === "save") {
      if (isActiveWorkflowTab()) { shell.updateStatusBar?.("Saving..."); sendWorkflowCommand("arcrho:workflow-save"); }
      else if (isActiveDFMTab()) { shell.updateStatusBar?.("Saving..."); sendDFMCommand("arcrho:dfm-save"); }
      else if (isActiveScriptingTab()) { shell.updateStatusBar?.("Saving..."); sendScriptingCommand("arcrho:scripting-save"); }
      else if (isActiveProjectSettingsReservingClassTypesTab()) { shell.updateStatusBar?.("Saving reserving class types to local file..."); sendProjectSettingsCommand("arcrho:project-settings-reserving-class-types-save-local"); }
      else if (isActiveProjectSettingsDatasetTypesTab()) { shell.updateStatusBar?.("Saving dataset types to local file..."); sendProjectSettingsCommand("arcrho:project-settings-dataset-types-save-local"); }
    } else if (action === "save-as") {
      if (isActiveWorkflowTab()) { shell.updateStatusBar?.("Saving as..."); sendWorkflowCommand("arcrho:workflow-save-as"); }
      else if (isActiveDFMTab()) { shell.updateStatusBar?.(isActiveDFMDetailsTab() ? "Saving template..." : "Saving as..."); sendDFMCommand(isActiveDFMDetailsTab() ? "arcrho:dfm-save-template" : "arcrho:dfm-save-as"); }
      else if (isActiveScriptingTab()) { shell.updateStatusBar?.("Saving as..."); sendScriptingCommand("arcrho:scripting-save-as"); }
      else if (isActiveProjectSettingsReservingClassTypesTab()) { shell.updateStatusBar?.("Loading reserving class types from local file..."); sendProjectSettingsCommand("arcrho:project-settings-reserving-class-types-load-local"); }
      else if (isActiveProjectSettingsDatasetTypesTab()) { shell.updateStatusBar?.("Loading dataset types from local file..."); sendProjectSettingsCommand("arcrho:project-settings-dataset-types-load-local"); }
    } else if (action === "import-workflow") shell.importWorkflow?.();
    else if (action === "close-tab") shell.closeTab?.(shell.state.activeId);
    else if (action === "print") shell.printActiveTab?.();
    else if (action === "restart-app") shell.restartApplication?.();
    else if (action === "shutdown-app") shell.shutdownApplication?.();
  });
  viewMenuDropdown?.addEventListener("click", (e) => {
    const item = e.target?.closest?.(".menuItem");
    const action = item?.getAttribute("data-action");
    if (!action || item.classList.contains("disabled")) return;
    toggleViewMenu(false);
    if (action === "toggle-ai-bot-icon") {
      const visible = toggleAiAssistantLauncherVisible();
      shell.updateStatusBar?.(`AI bot icon ${visible ? "shown" : "hidden"}.`);
    } else if (action === "toggle-nav") {
      toggleNavigationPanel();
    } else if (action === "toggle-line-numbers") {
      sendScriptingCommand("arcrho:scripting-toggle-line-numbers");
    } else if (action === "toggle-exec-time") {
      sendScriptingCommand("arcrho:scripting-toggle-exec-time");
    }
  });
  settingsMenuDropdown?.addEventListener("click", (e) => { const item = e.target?.closest?.(".menuItem"); const action = item?.getAttribute("data-action"); if (!action) return; toggleSettingsMenu(false); if (action === "font-settings") shell.openFontSettingsModal?.(); else if (action === "root-path-settings") shell.openRootPathSettingsModal?.(); else if (action === "force-rebuild-settings") shell.openForceRebuildSettingsModal?.(); else if (action === "refresh-page") shell.refreshActiveTab?.(); else if (action === "clear-cache-reload") shell.clearCacheAndReload?.(); });
  editMenuDropdown?.addEventListener("click", (e) => { const item = e.target?.closest?.(".menuItem"); const action = item?.getAttribute("data-action"); if (!action || item.classList.contains("disabled")) return; toggleEditMenu(false); if (action === "dfm-exclude-high") sendDFMCommand("arcrho:dfm-exclude-high"); else if (action === "dfm-exclude-low") sendDFMCommand("arcrho:dfm-exclude-low"); else if (action === "dfm-include-all") sendDFMCommand("arcrho:dfm-include-all"); else if (action === "render-all-markdown") sendScriptingCommand("arcrho:scripting-render-all-markdown"); });
  document.addEventListener("pointerdown", (e) => { const hit = e.target?.closest?.(".menu, .menuDropdown, .tabMenu, .plusTab, #tabCtxMenu"); if (!hit) closeAllShellMenus(); }, true);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllShellMenus(); }, true);
  window.addEventListener("resize", () => { if (fileMenuDropdown?.classList.contains("open")) positionDropdown(fileMenuBtn, fileMenuDropdown); if (editMenuDropdown?.classList.contains("open")) positionDropdown(editMenuBtn, editMenuDropdown); if (viewMenuDropdown?.classList.contains("open")) positionDropdown(viewMenuBtn, viewMenuDropdown); if (settingsMenuDropdown?.classList.contains("open")) positionDropdown(settingsMenuBtn, settingsMenuDropdown); shell.clampFloatingTabsToContent?.(); });
}
