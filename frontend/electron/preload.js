const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

// Splash screen progress API
contextBridge.exposeInMainWorld("electronAPI", {
  onSplashProgress: (callback) => {
    ipcRenderer.on("splash-progress", (_event, data) => callback(data));
  },
});

contextBridge.exposeInMainWorld("ADAHost", {
  isWindows11: () => invoke("is-windows-11"),
  getWindowsUserName: () => invoke("get-windows-user-name"),
  pickOpenWorkflowFile: (startDir) => invoke("pick-open-workflow", { startDir }),
  pickOpenTableFile: (startDir) => invoke("pick-open-table-file", { startDir }),
  pickFolder: (startDir) => invoke("pick-folder", { startDir }),
  findArcRhoServerRoot: () => invoke("find-arcrho-server-root"),
  pickSaveWorkflowFile: (suggestedName, startDir) =>
    invoke("pick-save-workflow", { suggestedName, startDir }),
  shutdownApp: () => invoke("app-shutdown"),
  minimizeWindow: () => invoke("window-minimize"),
  maximizeWindow: () => invoke("window-maximize"),
  restoreWindow: () => invoke("window-restore-native"),
  isMaximized: () => invoke("window-is-maximized"),
  isFullscreen: () => invoke("window-is-fullscreen"),
  setFullscreen: (enabled) => invoke("window-set-fullscreen", { enabled }),
  exitFullscreenToLast: () => invoke("window-restore-to-last"),
  getWindowSize: () => invoke("window-get-size"),
  resizeWindow: (width, height) => invoke("window-resize", { width, height }),
  isPseudoMaximized: () => invoke("window-is-pseudo-maximized"),
  pseudoMaximize: (margin) => invoke("window-pseudo-maximize", { margin }),
  restoreToLast: () => invoke("window-restore-to-last"),
  getZoomFactor: () => invoke("zoom-get"),
  setZoomFactor: (factor) => invoke("zoom-set", { factor }),
  getDocumentsPath: () => invoke("get-documents-path"),
  saveJsonFile: (payload) => invoke("save-json-file", payload),
  saveTextFile: (payload) => invoke("save-text-file", payload),
  readJsonFile: (payload) => invoke("read-json-file", payload),
  loadScriptingShortcuts: () => invoke("scripting-shortcuts-load"),
  saveScriptingShortcuts: (bindings) => invoke("scripting-shortcuts-save", { bindings }),
  pickOpenFile: (payload) => invoke("pick-open-file", payload),
  openPath: (payload) => invoke("open-path", payload),
  codexAssistantStatus: () => invoke("codex-assistant-status"),
  codexAssistantInstall: () => invoke("codex-assistant-install"),
  codexAssistantLogin: () => invoke("codex-assistant-login"),
  codexAssistantSend: (payload) => invoke("codex-assistant-send", payload),
  clearCacheAndReload: () => invoke("app-clear-cache-reload"),
  focusWindow: () => invoke("focus-window"),
});

window.addEventListener("DOMContentLoaded", () => {
  try {
    window.dispatchEvent(new Event("adaHostReady"));
  } catch {
    // ignore
  }
});

ipcRenderer.on("arcrho:close-active-tab", () => {
  try {
    window.postMessage({ type: "arcrho:close-active-tab" }, "*");
  } catch {
    // ignore
  }
});

ipcRenderer.on("arcrho:hotkey", (_event, payload) => {
  try {
    window.postMessage({ type: "arcrho:hotkey", action: payload?.action }, "*");
  } catch {
    // ignore
  }
});

ipcRenderer.on("arcrho:zoom", (_event, payload) => {
  try {
    window.postMessage({ type: "arcrho:zoom", deltaY: payload?.deltaY }, "*");
  } catch {
    // ignore
  }
});

ipcRenderer.on("arcrho:zoom-step", (_event, payload) => {
  try {
    window.postMessage({ type: "arcrho:zoom-step", delta: payload?.delta }, "*");
  } catch {
    // ignore
  }
});

ipcRenderer.on("arcrho:zoom-reset", () => {
  try {
    window.postMessage({ type: "arcrho:zoom-reset" }, "*");
  } catch {
    // ignore
  }
});
