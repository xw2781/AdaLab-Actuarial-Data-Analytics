const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");

// Detect Windows 11 (build number >= 22000)
function isWindows11() {
  if (process.platform !== "win32") return false;
  const release = os.release(); // e.g., "10.0.22000"
  const parts = release.split(".");
  const build = parseInt(parts[2], 10);
  return !isNaN(build) && build >= 22000;
}

const IS_WIN11 = isWindows11();

const HOST = process.env.ARCRHO_HOST || "127.0.0.1";
const PORT = parseInt(process.env.ARCRHO_PORT || "8000", 10);
const UI_VERSION = process.env.ARCRHO_UI_VERSION || String(Date.now());
const URL = `http://${HOST}:${PORT}/ui/?v=${encodeURIComponent(UI_VERSION)}`;
const START_BACKEND = process.env.ARCRHO_START_BACKEND !== "0";
const PYTHON_EXE = process.env.PYTHON_EXE || process.env.PYTHON || "python";
const APP_ROOT = path.resolve(__dirname, "..");
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const MAIN_WINDOW_PREFS_FILE = "main_window_prefs.json";
const SCRIPTING_SHORTCUTS_FILE = "scripting_shortcuts.json";
const WORKSPACE_PATHS_FILE = "workspace_paths.json";
const CODEX_ASSISTANT_TIMEOUT_MS = Math.max(
  15000,
  parseInt(process.env.ARCRHO_CODEX_ASSISTANT_TIMEOUT_MS || "120000", 10) || 120000
);
const BACKEND_CONTROL_FLAGS = [
  ".restart_app",
  ".shutdown_app",
  ".restart_electron",
  ".shutdown_electron",
];
const BACKEND_STARTUP_TIMEOUT_MS = Math.max(
  5000,
  parseInt(process.env.ARCRHO_BACKEND_STARTUP_TIMEOUT_MS || "30000", 10) || 30000
);
const BACKEND_STARTUP_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.ARCRHO_BACKEND_STARTUP_ATTEMPTS || "2", 10) || 2
);

function getBundledServerPath() {
  // Check if running as packaged app
  if (app.isPackaged) {
    // In packaged app, server is in resources/arcrho_server/arcrho_server.exe
    const resourcesPath = process.resourcesPath;
    return path.join(resourcesPath, "arcrho_server", "arcrho_server.exe");
  }
  return null;
}

let win = null;
let splashWin = null;
let serverProc = null;
let allowClose = false;
let pseudoMaximized = false;
let lastBounds = null;
let serverSpawnError = null;
let backendShutdownPromise = null;
const mappedDriveRemoteCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMainWindowPrefsPath() {
  return path.join(getPrefsDir(), MAIN_WINDOW_PREFS_FILE);
}

function getPrefsDir() {
  return path.join(app.getPath("appData"), "ArcRho", "prefs");
}

function getScriptingShortcutsPath() {
  return path.join(getPrefsDir(), SCRIPTING_SHORTCUTS_FILE);
}

function getWorkspacePathsPath() {
  return path.join(app.getPath("appData"), "ArcRho", WORKSPACE_PATHS_FILE);
}

function getConfiguredWorkspaceRoot() {
  try {
    const filePath = getWorkspacePathsPath();
    if (!fs.existsSync(filePath)) return "";
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return String(parsed?.workspace_root || "").trim();
  } catch {
    return "";
  }
}

function getCodexAssistantProjectRoot() {
  const configuredRoot = getConfiguredWorkspaceRoot();
  if (configuredRoot) return configuredRoot;
  return APP_ROOT;
}

function isUncPath(filePath) {
  return /^\\\\[^\\]+\\[^\\]+/u.test(String(filePath || "").trim());
}

function getLocalArcRhoAssistantRoot() {
  const userHome = process.env.USERPROFILE || os.homedir();
  const basePath = path.join(userHome, "Documents");
  return path.join(basePath, "ArcRho");
}

function ensureLocalArcRhoAssistantRoot() {
  const localRoot = getLocalArcRhoAssistantRoot();
  fs.mkdirSync(localRoot, { recursive: true });
  return localRoot;
}

function parseNetUseRemoteName(output) {
  const match = String(output || "").match(/^\s*Remote name\s+(.+?)\s*$/im);
  return match ? match[1].trim() : "";
}

function toMappedDriveUncPath(localPath, remoteName) {
  const text = String(localPath || "").trim();
  const remote = String(remoteName || "").trim();
  if (!/^[A-Za-z]:[\\/]/u.test(text) || !/^\\\\[^\\]+\\[^\\]+/u.test(remote)) return text;
  const rest = text.slice(2).replace(/^[\\/]+/u, "");
  return rest ? path.win32.join(remote, rest) : remote;
}

async function resolveMappedDrivePath(localPath) {
  const text = String(localPath || "").trim();
  if (process.platform !== "win32" || !/^[A-Za-z]:[\\/]/u.test(text)) return text;

  const drive = text.slice(0, 2).toUpperCase();
  if (!mappedDriveRemoteCache.has(drive)) {
    const result = await runHostCommand("net", ["use", drive], {
      timeoutMs: 3000,
      shell: false,
    });
    mappedDriveRemoteCache.set(drive, result.ok ? parseNetUseRemoteName(combinedCommandOutput(result)) : "");
  }

  const remoteName = mappedDriveRemoteCache.get(drive);
  return remoteName ? toMappedDriveUncPath(text, remoteName) : text;
}

async function getCodexAssistantProjectRoots(options = {}) {
  const { ensureLocalRoot = false } = options;
  const configuredRoot = getCodexAssistantProjectRoot();
  const resolvedProjectRoot = await resolveMappedDrivePath(configuredRoot);
  const networkRoot = isUncPath(resolvedProjectRoot);
  const localArcRhoRoot = networkRoot
    ? (ensureLocalRoot ? ensureLocalArcRhoAssistantRoot() : getLocalArcRhoAssistantRoot())
    : "";
  return {
    projectRoot: resolvedProjectRoot,
    cliRoot: networkRoot ? localArcRhoRoot : resolvedProjectRoot,
    networkRoot,
  };
}

function getBundledNpmCommand() {
  if (process.platform === "win32") {
    const bundled = path.join(APP_ROOT, "node-portable", "npm.cmd");
    return fs.existsSync(bundled) ? bundled : "";
  }
  const bundled = path.join(APP_ROOT, "node-portable", "npm");
  return fs.existsSync(bundled) ? bundled : "";
}

function getNpmCommand() {
  const configured = String(process.env.ARCRHO_NPM_CMD || "").trim();
  if (configured) return configured;
  return getBundledNpmCommand() || "npm";
}

function isWindowsAppsPath(filePath) {
  return /\\WindowsApps\\/iu.test(String(filePath || ""));
}

function findExecutableOnPath(names) {
  const pathText = String(process.env.PATH || process.env.Path || "");
  const pathParts = pathText.split(path.delimiter).filter(Boolean);
  for (const dir of pathParts) {
    if (isWindowsAppsPath(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // Skip inaccessible PATH entries.
      }
    }
  }
  return "";
}

function getCodexCommand() {
  const configured = String(process.env.ARCRHO_CODEX_CMD || "").trim();
  if (configured) return configured;

  if (process.platform === "win32") {
    const candidates = [
      path.join(APP_ROOT, "node-portable", "codex.cmd"),
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.cmd") : "",
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.cmd")
        : "",
      findExecutableOnPath(["codex.cmd", "codex.exe"]),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && !isWindowsAppsPath(candidate)) return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return "";
  }

  return findExecutableOnPath(["codex"]) || "codex";
}

function runHostCommand(command, args = [], options = {}) {
  const {
    cwd = APP_ROOT,
    env = process.env,
    input = "",
    timeoutMs = 15000,
    windowsHide = true,
    shell: useShell = process.platform === "win32",
  } = options;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let proc = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: result.code === 0 && !timedOut,
        code: result.code,
        signal: result.signal,
        stdout,
        stderr,
        timedOut,
        error: result.error || "",
      });
    };

    try {
      proc = spawn(command, args, {
        cwd,
        env,
        shell: useShell,
        windowsHide,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      finish({ code: -1, signal: null, error: String(err?.message || err) });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, Math.max(1000, timeoutMs));

    proc.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "");
      if (stdout.length > 200000) stdout = stdout.slice(-200000);
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
      if (stderr.length > 200000) stderr = stderr.slice(-200000);
    });
    proc.once("error", (err) => {
      clearTimeout(timer);
      finish({ code: -1, signal: null, error: String(err?.message || err) });
    });
    proc.once("close", (code, signal) => {
      clearTimeout(timer);
      finish({ code: Number.isFinite(code) ? code : -1, signal });
    });

    if (input) proc.stdin?.write(String(input));
    proc.stdin?.end();
  });
}

function quoteWindowsCmdArg(value) {
  const text = String(value ?? "");
  if (!text) return '""';
  if (!/[\s"]/u.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function runWindowsCmdCommand(command, args = [], options = {}) {
  const commandLine = [command, ...args].map(quoteWindowsCmdArg).join(" ");
  return runHostCommand("cmd.exe", ["/d", "/c", "call", commandLine], {
    ...options,
    shell: false,
  });
}

function runCodexCommand(args = [], options = {}) {
  const command = getCodexCommand();
  if (!command) {
    return Promise.resolve({
      ok: false,
      code: -1,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "Codex CLI was not found. Install Codex CLI before using ArcBot.",
    });
  }
  if (process.platform === "win32") {
    const bundledCodexCmd = path.join(APP_ROOT, "node-portable", "codex.cmd");
    if (command.toLowerCase() === bundledCodexCmd.toLowerCase()) {
      const bundledNode = path.join(APP_ROOT, "node-portable", "node.exe");
      const bundledCodexJs = path.join(APP_ROOT, "node-portable", "node_modules", "@openai", "codex", "bin", "codex.js");
      if (fs.existsSync(bundledNode) && fs.existsSync(bundledCodexJs)) {
        return runHostCommand(bundledNode, [bundledCodexJs, ...args], {
          ...options,
          shell: false,
        });
      }
    }
    if (/\.(cmd|bat)$/iu.test(command)) {
      return runWindowsCmdCommand(command, args, options);
    }
    return runHostCommand(command, args, {
      ...options,
      shell: false,
    });
  }
  return runHostCommand(command, args, {
    ...options,
    shell: false,
  });
}

function combinedCommandOutput(result) {
  return `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
}

function normalizeHostError(result, fallback) {
  if (result?.timedOut) return "The command timed out.";
  return combinedCommandOutput(result) || result?.error || fallback;
}

function isAuthFailure(result) {
  const raw = combinedCommandOutput(result).toLowerCase();
  return /not\s+logged\s+in|not\s+authenticated|authentication|required|sign\s*in|login/.test(raw);
}

function getCodexInstallScriptPath() {
  return path.join(app.getPath("userData"), "install_codex_cli.ps1");
}

function writeCodexInstallScript() {
  const scriptPath = getCodexInstallScriptPath();
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  const script = [
    "param([string]$NpmCommand = 'npm')",
    "$ErrorActionPreference = 'Stop'",
    "Write-Output 'ArcRho is installing Codex CLI with: npm install -g @openai/codex'",
    "$resolvedNpm = $null",
    "if (Test-Path -LiteralPath $NpmCommand) {",
    "  $resolvedNpm = Resolve-Path -LiteralPath $NpmCommand",
    "} else {",
    "  $resolvedNpm = Get-Command $NpmCommand -ErrorAction SilentlyContinue",
    "  if (-not $resolvedNpm) { throw 'npm was not found. Install Node.js/npm, then try again.' }",
    "}",
    "$npmPath = if ($resolvedNpm.Path) { $resolvedNpm.Path } else { [string]$resolvedNpm }",
    "$npmDir = Split-Path -Parent $npmPath",
    "if ($npmDir) { $env:Path = \"$npmDir;$env:Path\" }",
    "& $NpmCommand install -g @openai/codex",
    "Write-Output 'Codex CLI install completed.'",
    "$codexCmd = Join-Path $npmDir 'codex.cmd'",
    "if (Test-Path -LiteralPath $codexCmd) { & $codexCmd --version } else { & codex --version }",
    "",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

function buildAssistantPrompt(messages, mode = "review", projectRoot = "", cliRoot = "", networkRoot = false) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-12) : [];
  const transcript = safeMessages
    .map((message) => {
      const role = String(message?.role || "").toLowerCase() === "assistant" ? "Assistant" : "User";
      const text = String(message?.content || "").trim();
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return [
    "You are ArcBot, the ArcRho in-app AI assistant.",
    `Current mode: ${mode === "review" ? "Review Mode" : "Unsupported Mode"}.`,
    `Current project folder: ${projectRoot || APP_ROOT}.`,
    `CLI working folder: ${cliRoot || projectRoot || APP_ROOT}.`,
    networkRoot
      ? "The project folder is a network path, so the CLI process starts from the local Documents\\ArcRho folder to avoid Windows/Codex startup failures with UNC working directories."
      : "",
    "Review Mode is read-only. Do not edit files, change settings, install packages, run destructive commands, commit code, or push code.",
    "If the user asks for changes, explain what you would do and ask them to approve a future Edit Mode flow.",
    "Keep answers concise and focused on the ArcRho desktop app context.",
    "",
    "Conversation:",
    transcript || "User: Hello",
  ].join("\n");
}

function clampCodexPrompt(prompt) {
  const text = String(prompt || "");
  const maxChars = 16000;
  if (text.length <= maxChars) return text;
  return [
    text.slice(0, 12000),
    "",
    "[Earlier conversation was truncated to fit the Codex CLI prompt argument limit.]",
    "",
    text.slice(-3500),
  ].join("\n");
}

function loadMainWindowPrefs() {
  try {
    const prefPath = getMainWindowPrefsPath();
    if (!fs.existsSync(prefPath)) return null;
    const raw = fs.readFileSync(prefPath, "utf8");
    const parsed = JSON.parse(raw);
    const width = Math.round(Number(parsed?.width || 0));
    const height = Math.round(Number(parsed?.height || 0));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width < 820 || height < 620) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function saveMainWindowPrefs(sizeLike) {
  try {
    const width = Math.round(Number(sizeLike?.width || 0));
    const height = Math.round(Number(sizeLike?.height || 0));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    if (width < 820 || height < 620) return;

    const prefPath = getMainWindowPrefsPath();
    fs.mkdirSync(path.dirname(prefPath), { recursive: true });

    const payload = {
      width,
      height,
      updated_at: new Date().toISOString(),
    };
    const tmpPath = `${prefPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmpPath, prefPath);
  } catch {
    // ignore preference write failures
  }
}

function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWin.loadFile(path.join(APP_ROOT, "ui", "splash.html"));
  return splashWin;
}

function updateSplashProgress(progress, text) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send("splash-progress", { progress, text });
  }
}

function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.close();
    splashWin = null;
  }
}

function httpPost(pathname) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        method: "POST",
        host: HOST,
        port: PORT,
        path: pathname,
        timeout: 1500,
      },
      () => resolve(true)
    );
    req.on("error", () => resolve(false));
    req.end();
  });
}

function getBackendFlagRoots() {
  const roots = new Set([APP_ROOT]);
  const bundledServer = getBundledServerPath();
  if (bundledServer) roots.add(path.dirname(bundledServer));
  return Array.from(roots);
}

function clearBackendControlFlags() {
  for (const root of getBackendFlagRoots()) {
    for (const flagName of BACKEND_CONTROL_FLAGS) {
      const flagPath = path.join(root, flagName);
      try {
        if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
      } catch {
        // ignore stale-flag cleanup failures
      }
    }
  }
}

function isBackendProcAlive(proc) {
  return !!proc && !proc.killed && proc.exitCode == null;
}

async function waitForProcExit(proc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isBackendProcAlive(proc) && Date.now() < deadline) {
    await sleep(120);
  }
  return !isBackendProcAlive(proc);
}

function forceKillBackendProc(proc) {
  if (!proc || !proc.pid || !isBackendProcAlive(proc)) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  proc.kill("SIGTERM");
}

function startBackend() {
  const env = { ...process.env };
  env.TRI_DATA_DIR = env.TRI_DATA_DIR || APP_ROOT;
  env.ARCRHO_WORKFLOW_DIR =
    env.ARCRHO_WORKFLOW_DIR ||
    path.join(require("os").homedir(), "Documents", "ArcRho", "workflows");
  serverSpawnError = null;

  const bundledServer = getBundledServerPath();

  if (bundledServer && fs.existsSync(bundledServer)) {
    // Use bundled server exe
    const args = ["--host", HOST, "--port", String(PORT)];
    serverProc = spawn(bundledServer, args, {
      cwd: path.dirname(bundledServer),
      env,
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    // Development mode: use Python
    const appShell = path.join(APP_ROOT, "app_shell.py");
    const cmd = [appShell, "--host", HOST, "--port", String(PORT)];
    const args = ["-u", cmd[0], ...cmd.slice(1)];
    serverProc = spawn(PYTHON_EXE, args, {
      cwd: APP_ROOT,
      env,
      stdio: "ignore",
      windowsHide: true,
    });
  }

  serverProc.once("error", (err) => {
    serverSpawnError = err;
  });
}

async function waitForServer(timeoutMs = BACKEND_STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverSpawnError) {
      const msg = String(serverSpawnError?.message || serverSpawnError);
      throw new Error(`App server spawn failed: ${msg}`);
    }
    if (serverProc && serverProc.exitCode != null) {
      const signal = serverProc.signalCode || "none";
      throw new Error(
        `App server process exited before readiness (code=${serverProc.exitCode}, signal=${signal})`
      );
    }
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(URL, (res) => {
          res.destroy();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
          else reject();
        });
        req.setTimeout(1500, () => {
          req.destroy(new Error("timeout"));
        });
        req.on("error", reject);
      });
      return;
    } catch {
      await sleep(400);
    }
  }
  throw new Error("Server did not start in time");
}

async function startBackendWithRetry() {
  let lastErr = null;
  for (let attempt = 1; attempt <= BACKEND_STARTUP_ATTEMPTS; attempt++) {
    clearBackendControlFlags();
    startBackend();
    try {
      await waitForServer(BACKEND_STARTUP_TIMEOUT_MS);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`App server startup attempt ${attempt}/${BACKEND_STARTUP_ATTEMPTS} failed:`, err);
      await terminateBackend({ force: true });
      if (attempt < BACKEND_STARTUP_ATTEMPTS) {
        await sleep(700);
      }
    }
  }
  throw lastErr || new Error("Server did not start in time");
}

async function terminateBackend(options = {}) {
  const { force = false, gracefulTimeoutMs = 1600 } = options;
  const proc = serverProc;
  if (!proc) return;

  if (force) {
    forceKillBackendProc(proc);
    await waitForProcExit(proc, 900);
    if (serverProc === proc) serverProc = null;
    return;
  }

  const exitedGracefully = await waitForProcExit(proc, gracefulTimeoutMs);
  if (!exitedGracefully) {
    forceKillBackendProc(proc);
    await waitForProcExit(proc, 900);
  }
  if (serverProc === proc) serverProc = null;
}

async function requestBackendShutdown() {
  if (backendShutdownPromise) {
    await backendShutdownPromise;
    return;
  }
  backendShutdownPromise = (async () => {
    await httpPost("/app/shutdown");
    await terminateBackend();
  })();
  try {
    await backendShutdownPromise;
  } finally {
    backendShutdownPromise = null;
  }
}

function createWindow() {
  const savedSize = loadMainWindowPrefs();
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenWidth = Math.round(Number(primaryDisplay?.size?.width || 0));
  const screenHeight = Math.round(Number(primaryDisplay?.size?.height || 0));
  const launchMaxWidth = screenWidth > 0 ? Math.max(320, Math.floor(screenWidth * 0.9)) : 1400;
  const launchMaxHeight = screenHeight > 0 ? Math.max(320, Math.floor(screenHeight * 0.93)) : 900;
  const launchWidth = Math.min(Math.round(savedSize?.width || 1400), launchMaxWidth);
  const launchHeight = Math.min(Math.round(savedSize?.height || 900), launchMaxHeight);
  win = new BrowserWindow({
    width: launchWidth,
    height: launchHeight,
    frame: false,
    thickFrame: true,  // Adds Windows border for resize handles and visibility on Win10
    show: false,  // Hidden until splash closes
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("close", async (e) => {
    if (allowClose) return;
    e.preventDefault();
    try {
      const shouldIntercept = await win.webContents.executeJavaScript(
        "window.__arcrho_should_intercept_close && window.__arcrho_should_intercept_close()"
      );
      if (shouldIntercept) {
        win.webContents.executeJavaScript(
          "window.postMessage({type:'arcrho:close-active-tab'}, '*');"
        );
        return;
      }
    } catch {
      // ignore
    }

    try {
      const confirmed = await win.webContents.executeJavaScript(
        "window.__arcrho_confirm_app_shutdown ? window.__arcrho_confirm_app_shutdown() : true"
      );
      if (!confirmed) {
        return;
      }
    } catch {
      // ignore
    }

    allowClose = true;
    await requestBackendShutdown();
    setTimeout(() => {
      try { win.close(); } catch {}
    }, 0);
  });

  let windowSizeSaveTimer = null;
  const scheduleWindowSizeSave = () => {
    if (windowSizeSaveTimer) clearTimeout(windowSizeSaveTimer);
    windowSizeSaveTimer = setTimeout(() => {
      windowSizeSaveTimer = null;
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized() || win.isMaximized() || win.isFullScreen() || pseudoMaximized) return;
      const [width, height] = win.getSize();
      saveMainWindowPrefs({ width, height });
    }, 200);
  };
  win.on("resize", scheduleWindowSizeSave);
  win.on("closed", () => {
    if (windowSizeSaveTimer) clearTimeout(windowSizeSaveTimer);
    windowSizeSaveTimer = null;
  });

  win.loadURL(URL);

  win.webContents.on("before-input-event", (event, input) => {
    if (!win || win.isDestroyed()) return;

    const key = String(input.key || "").toUpperCase();
    const ctrl = !!input.control;
    const alt = !!input.alt;
    const shift = !!input.shift;
    const type = String(input.type || "");

    const sendHotkey = (action) => {
      win.webContents.send("arcrho:hotkey", { action });
    };

    if (type === "mouseWheel" && ctrl) {
      event.preventDefault();
      const deltaY = Number(input.deltaY || 0);
      win.webContents.send("arcrho:zoom", { deltaY });
      return;
    }

    // Zoom shortcuts (Ctrl +/-/0)
    if (ctrl && !alt && (key === "-" || key === "_")) {
      event.preventDefault();
      win.webContents.send("arcrho:zoom-step", { delta: -1 });
      return;
    }
    if (ctrl && !alt && (key === "=" || key === "+")) {
      event.preventDefault();
      win.webContents.send("arcrho:zoom-step", { delta: 1 });
      return;
    }
    if (ctrl && !alt && key === "0") {
      event.preventDefault();
      win.webContents.send("arcrho:zoom-reset");
      return;
    }

    // Refresh shortcuts
    if (!alt && key === "F5") {
      event.preventDefault();
      sendHotkey("custom_refresh");
      return;
    }
    if (ctrl && !alt && key === "R" && shift) {
      event.preventDefault();
      sendHotkey("custom_hard_refresh");
      return;
    }
    if (ctrl && !alt && key === "R" && !shift) {
      event.preventDefault();
      sendHotkey("custom_refresh");
      return;
    }

    // File/menu shortcuts
    if (ctrl && !alt && !shift && key === "S") {
      event.preventDefault();
      sendHotkey("file_save");
      return;
    }
    if (ctrl && !alt && shift && key === "S") {
      event.preventDefault();
      sendHotkey("file_save_as");
      return;
    }
    if (ctrl && !alt && !shift && key === "O") {
      event.preventDefault();
      sendHotkey("file_import");
      return;
    }
    if (ctrl && !alt && !shift && key === "P") {
      event.preventDefault();
      sendHotkey("file_print");
      return;
    }
    if (ctrl && !alt && shift && key === "F") {
      event.preventDefault();
      sendHotkey("view_toggle_nav");
      return;
    }
    if (ctrl && !alt && !shift && key === "Q") {
      event.preventDefault();
      sendHotkey("app_shutdown");
      return;
    }
    if (ctrl && alt && key === "R") {
      event.preventDefault();
      sendHotkey("file_restart");
      return;
    }
    if (ctrl && !alt && shift && key === "K") {
      event.preventDefault();
      sendHotkey("clear_test_data");
      return;
    }

    // Tab management
    if (alt && !ctrl && !shift && key === "W") {
      event.preventDefault();
      win.webContents.send("arcrho:close-active-tab");
      return;
    }
    if (ctrl && !alt && !shift && key === "W") {
      event.preventDefault();
      win.webContents.send("arcrho:close-active-tab");
    }
  });
}

ipcMain.handle("pick-open-workflow", async (_event, payload) => {
  const startDir = payload?.startDir || "";
  const result = await dialog.showOpenDialog(win, {
    defaultPath: startDir || undefined,
    properties: ["openFile"],
    filters: [{ name: "Workflow", extensions: ["arcwf", "json"] }],
  });
  if (result.canceled || !result.filePaths?.length) return "";
  return result.filePaths[0];
});

ipcMain.handle("pick-open-table-file", async (_event, payload) => {
  const startDir = payload?.startDir || "";
  const result = await dialog.showOpenDialog(win, {
    defaultPath: startDir || undefined,
    properties: ["openFile"],
    filters: [
      { name: "Data Files", extensions: ["csv", "txt", "parquet", "xlsx", "xlsm", "xls"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return "";
  return result.filePaths[0];
});

ipcMain.handle("pick-folder", async (_event, payload) => {
  const startDir = String(payload?.startDir || "").trim();
  const defaultPath = startDir && fs.existsSync(startDir) ? startDir : undefined;
  const result = await dialog.showOpenDialog(win, {
    defaultPath,
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths?.length) return "";
  return result.filePaths[0];
});

ipcMain.handle("find-arcrho-server-root", async () => {
  if (process.platform !== "win32") return { found: false, path: "" };
  for (let code = 68; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    const candidate = path.join(drive, "ArcRho Server");
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return { found: true, path: candidate };
      }
    } catch {
      // Skip unavailable or inaccessible drives.
    }
  }
  return { found: false, path: "" };
});

ipcMain.handle("pick-save-workflow", async (_event, payload) => {
  const suggestedName = payload?.suggestedName || "workflow.arcwf";
  const startDir = payload?.startDir || "";
  const defaultPath = startDir ? path.join(startDir, suggestedName) : suggestedName;
  const result = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: [{ name: "Workflow", extensions: ["arcwf", "json"] }],
  });
  if (result.canceled || !result.filePath) return "";
  return result.filePath;
});

ipcMain.handle("pick-open-file", async (_event, payload) => {
  const startDir = payload?.startDir || "";
  const filters = Array.isArray(payload?.filters) && payload.filters.length
    ? payload.filters
    : [{ name: "All Files", extensions: ["*"] }];
  const result = await dialog.showOpenDialog(win, {
    defaultPath: startDir || undefined,
    properties: ["openFile"],
    filters,
  });
  if (result.canceled || !result.filePaths?.length) return "";
  return result.filePaths[0];
});

ipcMain.handle("open-path", async (_event, payload) => {
  const targetPath = String(payload?.path || "").trim();
  if (!targetPath) return { ok: false, error: "Empty path." };
  try {
    if (!fs.existsSync(targetPath)) {
      return { ok: false, error: `Path not found: ${targetPath}` };
    }
    const openErr = await shell.openPath(targetPath);
    if (openErr) return { ok: false, error: String(openErr) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("save-json-file", async (_event, payload) => {
  const data = payload?.data ?? null;
  const suggestedName = payload?.suggestedName || "data.json";
  const startDir = payload?.startDir || "";
  const filters = Array.isArray(payload?.filters) && payload.filters.length
    ? payload.filters
    : [{ name: "JSON", extensions: ["json"] }];
  let filePath = payload?.path || "";

  if (!filePath) {
    const defaultPath = startDir ? path.join(startDir, suggestedName) : suggestedName;
    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      filters,
    });
    if (result.canceled || !result.filePath) return { path: "", canceled: true };
    filePath = result.filePath;
  }

  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const content = formatJsonForSave(data);
    fs.writeFileSync(filePath, content, "utf8");
    return { path: filePath, canceled: false };
  } catch (err) {
    return { path: "", canceled: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("save-text-file", async (_event, payload) => {
  const data = payload?.data ?? "";
  const suggestedName = payload?.suggestedName || "data.txt";
  const startDir = payload?.startDir || "";
  let filePath = payload?.path || "";

  if (!filePath) {
    const defaultPath = startDir ? path.join(startDir, suggestedName) : suggestedName;
    const result = await dialog.showSaveDialog(win, { defaultPath });
    if (result.canceled || !result.filePath) return { path: "", canceled: true };
    filePath = result.filePath;
  }

  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, String(data), "utf8");
    return { path: filePath, canceled: false };
  } catch (err) {
    return { path: "", canceled: false, error: String(err?.message || err) };
  }
});

  function formatJsonForSave(data) {
    if (Array.isArray(data) && data.every((row) => Array.isArray(row))) {
      return formatRowArrayJson(data);
    }
    if (data && typeof data === "object") {
      const pattern = data.pattern;
      const avgFormula = data["average formulas"] ?? data["average formula"];
      const avgIndex = data["average index"];
      const summaryRows = data["summary rows"];
      const summaryHidden = data["summary hidden"];
      const summaryOrder = data["summary order"];
      const resultVector = data["result vector"];
      const notes = data.notes;
      const methodName = data.name ?? data["method name"];
      const outputType = data["output type"] ?? data.outputType;
      const inputTriangle = data["input triangle"];
      const decimalPlaces = data["decimal places"];
      const ultimateRatioDecimalPlaces = data["ultimate ratio decimal places"];
      const ratioBasisDataset = data["ratio basis dataset"];
      const hasPattern = Array.isArray(pattern) && pattern.every((row) => Array.isArray(row));
      const hasAvgIndex = Array.isArray(avgIndex) && avgIndex.every((row) => Array.isArray(row));
      const hasSelected = "selected" in data;
      const hasAvgFormula = "average formulas" in data || "average formula" in data;
      const hasSummaryRows = "summary rows" in data;
      const hasSummaryHidden = "summary hidden" in data;
      const hasSummaryOrder = "summary order" in data;
      const hasResultVector = "result vector" in data;
      const hasNotes = "notes" in data;
      const hasMethodName = "name" in data || "method name" in data;
      const hasOutputType = "output type" in data || "outputType" in data;
      const hasInputTriangle = "input triangle" in data;
      const hasDecimalPlaces = "decimal places" in data;
      const hasUltimateRatioDecimalPlaces = "ultimate ratio decimal places" in data;
      const hasRatioBasisDataset = "ratio basis dataset" in data;
      const hasOriginLen = "originLen" in data;
      const hasDevLen = "devLen" in data;
      if (hasPattern || hasAvgIndex || hasSelected || hasAvgFormula || hasSummaryRows || hasSummaryHidden || hasSummaryOrder || hasResultVector || hasNotes || hasInputTriangle || hasDecimalPlaces || hasUltimateRatioDecimalPlaces || hasRatioBasisDataset || hasOriginLen || hasDevLen) {
        const lines = [];
        lines.push("{");
        let wroteSection = false;
        if (hasOriginLen) {
          lines.push(`  "originLen": ${JSON.stringify(data.originLen)}`);
          wroteSection = true;
        }
        if (hasDevLen) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "devLen": ${JSON.stringify(data.devLen)}`);
          wroteSection = true;
        }
        if (hasPattern) {
          lines.push('  "pattern": [');
        lines.push(formatRowArrayLines(pattern, "    "));
        lines.push("  ]");
        wroteSection = true;
      }
      if (hasAvgFormula) {
        if (wroteSection) lines[lines.length - 1] += ",";
        lines.push(`  "average formulas": ${JSON.stringify(avgFormula)}`);
        wroteSection = true;
      }
      if (hasAvgIndex) {
        if (wroteSection) lines[lines.length - 1] += ",";
        lines.push('  "average index": [');
          lines.push(formatRowArrayLines(avgIndex, "    "));
          lines.push("  ]");
          wroteSection = true;
        }
        if (hasSummaryRows) {
          if (wroteSection) lines[lines.length - 1] += ",";
          const rowsJson = JSON.stringify(summaryRows, null, 2).split("\n");
          lines.push(`  "summary rows": ${rowsJson[0]}`);
          for (let i = 1; i < rowsJson.length; i++) {
            lines.push(`  ${rowsJson[i]}`);
          }
          wroteSection = true;
        }
        if (hasSummaryHidden) {
          if (wroteSection) lines[lines.length - 1] += ",";
          const hiddenJson = JSON.stringify(summaryHidden, null, 2).split("\n");
          lines.push(`  "summary hidden": ${hiddenJson[0]}`);
          for (let i = 1; i < hiddenJson.length; i++) {
            lines.push(`  ${hiddenJson[i]}`);
          }
          wroteSection = true;
        }
        if (hasSummaryOrder) {
          if (wroteSection) lines[lines.length - 1] += ",";
          const orderJson = JSON.stringify(summaryOrder, null, 2).split("\n");
          lines.push(`  "summary order": ${orderJson[0]}`);
          for (let i = 1; i < orderJson.length; i++) {
            lines.push(`  ${orderJson[i]}`);
          }
          wroteSection = true;
        }
        if (hasSelected) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "selected": ${JSON.stringify(data.selected)}`);
          wroteSection = true;
        }
        if (hasResultVector) {
          if (wroteSection) lines[lines.length - 1] += ",";
          const vectorJson = JSON.stringify(resultVector, null, 2).split("\n");
          lines.push(`  "result vector": ${vectorJson[0]}`);
          for (let i = 1; i < vectorJson.length; i++) {
            lines.push(`  ${vectorJson[i]}`);
          }
          wroteSection = true;
        }
        if (hasNotes) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "notes": ${JSON.stringify(typeof notes === "string" ? notes : "")}`);
          wroteSection = true;
        }
        if (hasMethodName) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "name": ${JSON.stringify(typeof methodName === "string" ? methodName : "")}`);
          wroteSection = true;
        }
        if (hasOutputType) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "output type": ${JSON.stringify(typeof outputType === "string" ? outputType : "")}`);
          wroteSection = true;
        }
        if (hasInputTriangle) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "input triangle": ${JSON.stringify(typeof inputTriangle === "string" ? inputTriangle : "")}`);
          wroteSection = true;
        }
        if (hasDecimalPlaces) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "decimal places": ${JSON.stringify(Number.isFinite(Number(decimalPlaces)) ? Number(decimalPlaces) : 4)}`);
          wroteSection = true;
        }
        if (hasUltimateRatioDecimalPlaces) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "ultimate ratio decimal places": ${JSON.stringify(Number.isFinite(Number(ultimateRatioDecimalPlaces)) ? Number(ultimateRatioDecimalPlaces) : 2)}`);
          wroteSection = true;
        }
        if (hasRatioBasisDataset) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "ratio basis dataset": ${JSON.stringify(typeof ratioBasisDataset === "string" ? ratioBasisDataset : "")}`);
          wroteSection = true;
        }
      lines.push("}");
      return `${lines.join("\n")}\n`;
    }
  }
  return JSON.stringify(data, null, 2);
}

function formatRowArrayLines(rows, indent) {
  return rows
    .map((row) => {
      const vals = row.map((v) => JSON.stringify(v)).join(", ");
      return `${indent}[${vals}]`;
    })
    .join(",\n");
}

function formatRowArrayJson(rows) {
  const lines = [];
  lines.push("[");
  lines.push(formatRowArrayLines(rows, "  "));
  lines.push("]");
  return `${lines.join("\n")}\n`;
}

ipcMain.handle("read-json-file", async (_event, payload) => {
  const filePath = String(payload?.path || "");
  if (!filePath) return { exists: false };
  try {
    if (!fs.existsSync(filePath)) return { exists: false };
    const raw = fs.readFileSync(filePath, "utf8");
    return { exists: true, data: JSON.parse(raw) };
  } catch (err) {
    return { exists: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("scripting-shortcuts-load", async () => {
  const filePath = getScriptingShortcutsPath();
  try {
    if (!fs.existsSync(filePath)) return { exists: false };
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const bindings = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed.bindings && typeof parsed.bindings === "object" && !Array.isArray(parsed.bindings)
        ? parsed.bindings
        : parsed)
      : null;
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
      return { exists: false, error: "Invalid shortcut settings format" };
    }
    return { exists: true, bindings };
  } catch (err) {
    return { exists: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("scripting-shortcuts-save", async (_event, payload) => {
  const bindings = payload?.bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    return { ok: false, error: "Invalid shortcuts payload" };
  }
  const filePath = getScriptingShortcutsPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const data = {
      bindings,
      updated_at: new Date().toISOString(),
    };
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("app-shutdown", async () => {
  allowClose = true;
  await requestBackendShutdown();
  app.quit();
  return true;
});

ipcMain.handle("app-clear-cache-reload", async () => {
  if (!win || win.isDestroyed()) return false;
  try {
    await win.webContents.session.clearCache();
    await win.webContents.session.clearStorageData();
  } catch {
    // ignore
  }
  try {
    win.webContents.reloadIgnoringCache();
  } catch {
    // ignore
  }
  return true;
});

ipcMain.handle("codex-assistant-status", async () => {
  const version = await runCodexCommand(["--version"], {
    timeoutMs: 8000,
  });
  if (!version.ok) {
    return {
      installed: false,
      authenticated: false,
      version: "",
      error: normalizeHostError(version, "Codex CLI was not found."),
    };
  }

  const auth = await runCodexCommand(["login", "status"], {
    timeoutMs: 8000,
  });
  return {
    installed: true,
    authenticated: auth.ok,
    version: combinedCommandOutput(version).split(/\r?\n/)[0] || "codex",
    authStatus: combinedCommandOutput(auth),
    error: auth.ok ? "" : normalizeHostError(auth, "Codex CLI is not signed in."),
  };
});

ipcMain.handle("codex-assistant-install", async () => {
  if (process.platform === "win32") {
    const scriptPath = writeCodexInstallScript();
    const result = await runHostCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-NpmCommand",
      getNpmCommand(),
    ], {
      timeoutMs: 10 * 60 * 1000,
      windowsHide: false,
      shell: false,
    });
    return {
      ok: result.ok,
      output: combinedCommandOutput(result),
      error: result.ok ? "" : normalizeHostError(result, "Codex CLI installation failed."),
    };
  }

  const result = await runHostCommand(getNpmCommand(), ["install", "-g", "@openai/codex"], {
    timeoutMs: 10 * 60 * 1000,
    windowsHide: false,
  });
  return {
    ok: result.ok,
    output: combinedCommandOutput(result),
    error: result.ok ? "" : normalizeHostError(result, "Codex CLI installation failed."),
  };
});

ipcMain.handle("codex-assistant-login", async () => {
  try {
    const codexCommand = getCodexCommand();
    if (!codexCommand) {
      return { ok: false, error: "Codex CLI was not found. Install Codex CLI before signing in." };
    }
    if (process.platform === "win32") {
      const child = spawn("cmd.exe", ["/d", "/k", `${quoteWindowsCmdArg(codexCommand)} login`], {
        cwd: APP_ROOT,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        shell: false,
      });
      child.unref();
      return { ok: true };
    }
    const child = spawn(codexCommand, ["login"], {
      cwd: APP_ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      shell: false,
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("codex-assistant-send", async (_event, payload) => {
  const mode = String(payload?.mode || "review").trim().toLowerCase();
  const model = String(payload?.model || "codex").trim().toLowerCase();
  if (mode !== "review") {
    return {
      ok: false,
      needsAuth: false,
      error: "Edit Mode is not available yet.",
    };
  }
  if (model !== "codex") {
    return {
      ok: false,
      needsAuth: false,
      error: "Only Codex is available for ArcBot right now.",
    };
  }
  const roots = await getCodexAssistantProjectRoots({ ensureLocalRoot: true });
  const prompt = clampCodexPrompt(
    buildAssistantPrompt(payload?.messages, mode, roots.projectRoot, roots.cliRoot, roots.networkRoot)
  );
  const result = await runCodexCommand([
    "exec",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--cd",
    roots.cliRoot,
  ], {
    input: prompt,
    timeoutMs: CODEX_ASSISTANT_TIMEOUT_MS,
  });

  if (!result.ok) {
    return {
      ok: false,
      needsAuth: isAuthFailure(result),
      error: normalizeHostError(result, "Codex CLI request failed."),
    };
  }
  return {
    ok: true,
    text: String(result.stdout || "").trim(),
    progress: String(result.stderr || "").trim(),
  };
});

ipcMain.handle("focus-window", () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
ipcMain.handle("get-documents-path", () => {
  try {
    return app.getPath("documents") || "";
  } catch {
    return "";
  }
});
ipcMain.handle("is-windows-11", () => IS_WIN11);
ipcMain.handle("window-minimize", () => win?.minimize());
ipcMain.handle("window-maximize", () => win?.maximize());
ipcMain.handle("window-restore-native", () => win?.restore());
ipcMain.handle("window-is-maximized", () => !!win?.isMaximized());
ipcMain.handle("window-is-fullscreen", () => !!win?.isFullScreen());
ipcMain.handle("window-set-fullscreen", (_e, payload) => {
  const enabled = !!payload?.enabled;
  win?.setFullScreen(enabled);
});
ipcMain.handle("window-get-size", () => {
  if (!win) return { width: 0, height: 0 };
  const [width, height] = win.getSize();
  return { width, height };
});
ipcMain.handle("window-resize", (_e, payload) => {
  if (!win) return;
  const w = Math.max(200, Number(payload?.width || 0));
  const h = Math.max(200, Number(payload?.height || 0));
  if (w && h) win.setSize(Math.round(w), Math.round(h));
});

ipcMain.handle("zoom-get", () => {
  if (!win) return 1;
  return win.webContents.getZoomFactor();
});

ipcMain.handle("zoom-set", (_e, payload) => {
  if (!win) return 1;
  const factor = Number(payload?.factor || 1);
  const safe = Math.max(0.5, Math.min(2, factor));
  win.webContents.setZoomFactor(safe);
  return safe;
});

ipcMain.handle("window-pseudo-maximize", (_e, payload) => {
  if (!win) return;
  const margin = Math.max(0, Number(payload?.margin ?? 1));
  lastBounds = win.getBounds();
  const display = screen.getDisplayMatching(lastBounds);
  const wa = display.workArea;
  const w = Math.max(200, wa.width - margin * 2);
  const h = Math.max(200, wa.height - margin * 2);
  win.setBounds({ x: wa.x + margin, y: wa.y + margin, width: w, height: h }, true);
  pseudoMaximized = true;
});

ipcMain.handle("window-is-pseudo-maximized", () => !!pseudoMaximized);

ipcMain.handle("window-restore-to-last", () => {
  if (!win) return;
  if (lastBounds) win.setBounds(lastBounds, true);
  pseudoMaximized = false;
});

app.whenReady().then(async () => {
  // Show splash screen first
  createSplashWindow();

  // Small delay to ensure splash is visible
  await new Promise((r) => setTimeout(r, 300));

  try {
    if (START_BACKEND) {
      updateSplashProgress(10, "Starting app server...");
      clearBackendControlFlags();

      updateSplashProgress(30, "Waiting for server...");
      await startBackendWithRetry();

      updateSplashProgress(60, "Server connected");
    }

    updateSplashProgress(80, "Loading interface...");
    createWindow();

    // Wait for main window to be ready before closing splash
    win.webContents.once("did-finish-load", () => {
      updateSplashProgress(100, "Launching application...");
      setTimeout(() => {
        closeSplash();
        win.show();
        win.focus();
      }, 400);
    });

  } catch (err) {
    console.error("Startup error:", err);
    closeSplash();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  allowClose = true;
  await requestBackendShutdown();
});
