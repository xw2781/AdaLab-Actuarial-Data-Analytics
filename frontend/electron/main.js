const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const crypto = require("crypto");

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

function normalizeComparablePath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/[\\/]+/g, "\\")
    .replace(/\\+$/u, "")
    .toLowerCase();
}

function isPathWithinRoot(filePath, rootPath) {
  const file = normalizeComparablePath(filePath);
  const root = normalizeComparablePath(rootPath);
  if (!file || !root) return false;
  return file === root || file.startsWith(`${root}\\`);
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

function getArcBotLatestEditPath() {
  return path.join(app.getPath("userData"), "arcbot_latest_edit.json");
}

function getArcBotSessionRoot() {
  return path.join(ensureLocalArcRhoAssistantRoot(), "ArcBot", "sessions");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function formatJsonForArcBot(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Continue with fenced/object extraction.
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue with first object extraction.
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function getAssistantTargetJsonPath(activeContext) {
  const page = activeContext && typeof activeContext === "object" ? activeContext : {};
  const candidates = [
    page.methodPath,
    page.filePath,
    page.targetPath,
    page?.dfm?.methodPath,
  ];
  return String(candidates.find((candidate) => String(candidate || "").trim()) || "").trim();
}

async function getArcBotEditRoots() {
  const configuredRoot = getConfiguredWorkspaceRoot();
  if (!configuredRoot) {
    return {
      configuredRoot: "",
      resolvedRoot: "",
    };
  }
  const resolvedRoot = await resolveMappedDrivePath(configuredRoot);
  return {
    configuredRoot,
    resolvedRoot,
  };
}

async function validateArcBotJsonTarget(targetPath) {
  const cleanPath = String(targetPath || "").trim();
  if (!cleanPath) return { ok: false, error: "ArcBot has no active JSON file to edit." };
  if (path.extname(cleanPath).toLowerCase() !== ".json") {
    return { ok: false, error: "ArcBot can only edit JSON files in this MVP." };
  }
  const roots = await getArcBotEditRoots();
  const allowed = [roots.configuredRoot, roots.resolvedRoot].filter(Boolean);
  if (allowed.length === 0) {
    return {
      ok: false,
      error: "ArcBot needs a configured Server Connection Root Path before it can edit files.",
    };
  }
  if (!allowed.some((root) => isPathWithinRoot(cleanPath, root))) {
    return {
      ok: false,
      error: "ArcBot refused to edit a file outside the configured Server Connection root.",
    };
  }
  return { ok: true, targetPath: cleanPath, roots };
}

function getArcBotHistoryDir(targetPath) {
  return path.join(path.dirname(targetPath), "history");
}

function writeArcBotLatestEdit(manifest) {
  const latestPath = getArcBotLatestEditPath();
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, formatJsonForArcBot(manifest), "utf8");
}

function createArcBotEditSession({ targetPath, activeJson }) {
  if (activeJson == null || typeof activeJson !== "object" || Array.isArray(activeJson)) {
    return null;
  }
  const sessionsRoot = getArcBotSessionRoot();
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const sessionDir = fs.mkdtempSync(path.join(sessionsRoot, "session-"));
  const jsonPath = path.join(sessionDir, "active-method.json");
  const metaPath = path.join(sessionDir, "session.json");
  const beforeText = formatJsonForArcBot(activeJson);
  const session = {
    sessionDir,
    jsonPath,
    metaPath,
    targetPath: String(targetPath || ""),
    beforeSha256: sha256Text(beforeText),
  };
  fs.writeFileSync(jsonPath, beforeText, "utf8");
  fs.writeFileSync(metaPath, formatJsonForArcBot({
    type: "arcbot-edit-session",
    createdAt: new Date().toISOString(),
    targetPath: session.targetPath,
    editableFile: jsonPath,
  }), "utf8");
  return session;
}

async function applyArcBotJsonEdit({ targetPath, replacementJson, requestText, reply, originalJson }) {
  const validation = await validateArcBotJsonTarget(targetPath);
  if (!validation.ok) return validation;
  if (replacementJson == null || typeof replacementJson !== "object" || Array.isArray(replacementJson)) {
    return { ok: false, error: "ArcBot did not provide a valid JSON object replacement." };
  }
  const hasOriginalFallback = originalJson != null && typeof originalJson === "object" && !Array.isArray(originalJson);
  let targetExists = false;
  try {
    const stat = fs.statSync(validation.targetPath);
    targetExists = stat.isFile();
  } catch {
    targetExists = false;
  }
  if (!targetExists && !hasOriginalFallback) {
    return { ok: false, error: `Target JSON file was not found: ${validation.targetPath}` };
  }
  let beforeText = "";
  let backupSource = "file";
  try {
    beforeText = fs.readFileSync(validation.targetPath, "utf8");
    JSON.parse(beforeText);
  } catch (err) {
    if (!hasOriginalFallback) {
      const message = String(err?.message || err || "Target file could not be read.");
      return { ok: false, error: `Target file could not be backed up, so ArcBot did not modify it. ${message}` };
    }
    beforeText = formatJsonForArcBot(originalJson);
    backupSource = "active-page-context";
  }

  const nextText = formatJsonForArcBot(replacementJson);
  const historyDir = getArcBotHistoryDir(validation.targetPath);
  fs.mkdirSync(historyDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(validation.targetPath, path.extname(validation.targetPath));
  const backupPath = path.join(historyDir, `${baseName}.${stamp}.bak.json`);
  const manifestPath = path.join(historyDir, `${baseName}.${stamp}.arcbot.json`);
  const tmpPath = `${validation.targetPath}.arcbot.tmp`;

  if (backupSource === "file") {
    fs.copyFileSync(validation.targetPath, backupPath);
  } else {
    fs.writeFileSync(backupPath, beforeText, "utf8");
  }
  fs.writeFileSync(tmpPath, nextText, "utf8");
  fs.renameSync(tmpPath, validation.targetPath);

  const manifest = {
    type: "arcbot-json-edit",
    timestamp: new Date().toISOString(),
    targetPath: validation.targetPath,
    backupPath,
    manifestPath,
    requestText: String(requestText || ""),
    reply: String(reply || ""),
    beforeSha256: sha256Text(beforeText),
    afterSha256: sha256Text(nextText),
    backupSource,
    allowedRoot: validation.roots.configuredRoot,
    resolvedAllowedRoot: validation.roots.resolvedRoot,
  };
  fs.writeFileSync(manifestPath, formatJsonForArcBot(manifest), "utf8");
  writeArcBotLatestEdit(manifest);
  return {
    ok: true,
    targetPath: validation.targetPath,
    backupPath,
    manifestPath,
    reply: manifest.reply || "Updated the active JSON file.",
  };
}

async function revertLatestArcBotEdit() {
  const latestPath = getArcBotLatestEditPath();
  if (!fs.existsSync(latestPath)) {
    return { ok: false, error: "No ArcBot edit history is available to revert." };
  }
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  } catch {
    return { ok: false, error: "ArcBot latest edit manifest is invalid." };
  }
  const validation = await validateArcBotJsonTarget(manifest?.targetPath);
  if (!validation.ok) return validation;
  const backupPath = String(manifest?.backupPath || "").trim();
  if (!backupPath || !fs.existsSync(backupPath)) {
    return { ok: false, error: "ArcBot backup file is missing, so the latest edit cannot be reverted." };
  }
  if (fs.existsSync(validation.targetPath)) {
    const currentText = fs.readFileSync(validation.targetPath, "utf8");
    if (manifest.afterSha256 && sha256Text(currentText) !== manifest.afterSha256) {
      return {
        ok: false,
        error: "ArcBot refused to revert because the target file changed after the latest ArcBot edit.",
      };
    }
  }
  fs.copyFileSync(backupPath, validation.targetPath);
  try {
    fs.unlinkSync(latestPath);
  } catch {
    // ignore stale latest-manifest cleanup errors
  }
  return {
    ok: true,
    targetPath: validation.targetPath,
    backupPath,
    reply: `Reverted the latest ArcBot edit for ${validation.targetPath}.`,
  };
}

function isRevertLatestRequest(messages) {
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  const text = String(last?.content || "").toLowerCase();
  return /\b(revert|undo|restore)\b/.test(text) && /\b(latest|last|previous|arcbot)\b/.test(text);
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

function buildAssistantPrompt(
  messages,
  mode = "edit",
  projectRoot = "",
  cliRoot = "",
  networkRoot = false,
  activeContext = null,
  activeJson = null,
  editSession = null
) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-12) : [];
  const transcript = safeMessages
    .map((message) => {
      const role = String(message?.role || "").toLowerCase() === "assistant" ? "Assistant" : "User";
      const text = String(message?.content || "").trim();
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const contextForPrompt = activeContext && typeof activeContext === "object"
    ? { ...activeContext }
    : { available: false };
  delete contextForPrompt.activeJson;
  const modeInstructions = mode === "edit"
    ? [
        editSession?.jsonPath
          ? `Editable active JSON copy: ${path.basename(editSession.jsonPath)}.`
          : "No editable active JSON copy is available for this request.",
        "ArcBot edits are host-applied only. Do not edit the true project/server file path directly.",
        "You may edit only the active JSON copy in the current working folder. Do not edit other files, install packages, commit code, or push code.",
        "If the user asks to modify the active DFM method, inspect and edit the active JSON copy directly.",
        "Preserve unrelated fields and JSON structure. Keep the file valid JSON.",
        "When finished, return a single JSON object only, with no Markdown.",
        "Allowed response shape:",
        '{"action":"edited","reply":"short summary"}',
        '{"action":"answer","reply":"short answer"}',
        "Use answer if the request is informational, ambiguous, outside the active JSON, or cannot be completed safely.",
      ]
    : [
        "Review Mode is read-only. Do not edit files, change settings, install packages, run destructive commands, commit code, or push code.",
        "Return a concise answer for the user.",
      ];
  return [
    "You are ArcBot, the ArcRho in-app AI assistant.",
    `Current mode: ${mode === "edit" ? "Edit Mode" : "Review Mode"}.`,
    `Current project folder: ${projectRoot || APP_ROOT}.`,
    `CLI working folder: ${cliRoot || projectRoot || APP_ROOT}.`,
    networkRoot
      ? "The project folder is a network path, so the CLI process starts from the local Documents\\ArcRho folder to avoid Windows/Codex startup failures with UNC working directories."
      : "",
    ...modeInstructions,
    "",
    "Active page context:",
    JSON.stringify(contextForPrompt, null, 2),
    "",
    "Active local JSON data:",
    editSession?.jsonPath
      ? `The active JSON is available as ${path.basename(editSession.jsonPath)} in the current working folder. Read and edit that file instead of returning replacement JSON.`
      : (activeJson ? JSON.stringify(activeJson, null, 2) : "No active JSON data was loaded."),
    "",
    "Conversation:",
    transcript || "User: Hello",
  ].join("\n");
}

function clampCodexPrompt(prompt) {
  const text = String(prompt || "");
  const maxChars = 200000;
  if (text.length <= maxChars) return text;
  return [
    text.slice(0, 150000),
    "",
    "[Prompt was truncated to keep the Codex CLI request bounded.]",
    "",
    text.slice(-45000),
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
      const ratioPattern = data["ratio pattern"];
      const originLabels = data["origin labels"];
      const developmentLabels = data["development labels"];
      const avgFormula = data["average formulas"];
      const avgIndex = data["average index"];
      const summaryRows = data["summary rows"];
      const summaryOrder = data["summary order"];
      const ultimateVector = data["ultimate vector"];
      const notes = data.notes;
      const methodName = data.name;
      const outputType = data["output type"];
      const inputTriangle = data["input triangle"];
      const originLength = data["origin length"];
      const developmentLength = data["development length"];
      const decimalPlaces = data["decimal places"];
      const ultimateRatioDecimalPlaces = data["ultimate ratio decimal places"];
      const ratioBasisDataset = data["ratio basis dataset"];
      const lastModified = data["last modified"];
      const hasRatioPattern = Array.isArray(ratioPattern) && ratioPattern.every((row) => Array.isArray(row));
      const hasOriginLabels = Array.isArray(originLabels);
      const hasDevelopmentLabels = Array.isArray(developmentLabels);
      const hasAvgIndex = Array.isArray(avgIndex) && avgIndex.every((row) => Array.isArray(row));
      const hasAvgFormula = "average formulas" in data;
      const hasSummaryRows = "summary rows" in data;
      const hasSummaryOrder = "summary order" in data;
      const hasUltimateVector = "ultimate vector" in data;
      const hasNotes = "notes" in data;
      const hasMethodName = "name" in data;
      const hasOutputType = "output type" in data;
      const hasInputTriangle = "input triangle" in data;
      const hasOriginLength = "origin length" in data;
      const hasDevelopmentLength = "development length" in data;
      const hasDecimalPlaces = "decimal places" in data;
      const hasUltimateRatioDecimalPlaces = "ultimate ratio decimal places" in data;
      const hasRatioBasisDataset = "ratio basis dataset" in data;
      const hasLastModified = "last modified" in data;
      if (hasRatioPattern || hasOriginLabels || hasDevelopmentLabels || hasAvgIndex || hasAvgFormula || hasSummaryRows || hasSummaryOrder || hasUltimateVector || hasNotes || hasInputTriangle || hasOriginLength || hasDevelopmentLength || hasDecimalPlaces || hasUltimateRatioDecimalPlaces || hasRatioBasisDataset || hasLastModified) {
        const lines = [];
        lines.push("{");
        let wroteSection = false;
        if (hasRatioPattern) {
          lines.push('  "ratio pattern": [');
        lines.push(formatRowArrayLines(ratioPattern, "    "));
        lines.push("  ]");
        wroteSection = true;
      }
      if (hasOriginLabels) {
        if (wroteSection) lines[lines.length - 1] += ",";
        lines.push(`  "origin labels": ${JSON.stringify(originLabels)}`);
        wroteSection = true;
      }
      if (hasDevelopmentLabels) {
        if (wroteSection) lines[lines.length - 1] += ",";
        lines.push(`  "development labels": ${JSON.stringify(developmentLabels)}`);
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
        if (hasSummaryOrder) {
          if (wroteSection) lines[lines.length - 1] += ",";
          const orderJson = JSON.stringify(summaryOrder, null, 2).split("\n");
          lines.push(`  "summary order": ${orderJson[0]}`);
          for (let i = 1; i < orderJson.length; i++) {
            lines.push(`  ${orderJson[i]}`);
          }
          wroteSection = true;
        }
        if (hasUltimateVector) {
          if (wroteSection) lines[lines.length - 1] += ",";
          const vectorJson = JSON.stringify(ultimateVector, null, 2).split("\n");
          lines.push(`  "ultimate vector": ${vectorJson[0]}`);
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
        if (hasOriginLength) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "origin length": ${JSON.stringify(Number.isFinite(Number(originLength)) ? Number(originLength) : null)}`);
          wroteSection = true;
        }
        if (hasDevelopmentLength) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "development length": ${JSON.stringify(Number.isFinite(Number(developmentLength)) ? Number(developmentLength) : null)}`);
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
        if (hasLastModified) {
          if (wroteSection) lines[lines.length - 1] += ",";
          lines.push(`  "last modified": ${JSON.stringify(typeof lastModified === "string" ? lastModified : "")}`);
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
    const reloadUrl = `http://${HOST}:${PORT}/ui/?v=${encodeURIComponent(String(Date.now()))}`;
    await win.loadURL(reloadUrl);
  } catch {
    try {
      win.webContents.reloadIgnoringCache();
    } catch {
      // ignore
    }
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
  const mode = String(payload?.mode || "edit").trim().toLowerCase();
  const model = String(payload?.model || "codex").trim().toLowerCase();
  if (mode !== "edit" && mode !== "review") {
    return {
      ok: false,
      needsAuth: false,
      error: "Unsupported ArcBot mode.",
    };
  }
  if (model !== "codex") {
    return {
      ok: false,
      needsAuth: false,
      error: "Only Codex is available for ArcBot right now.",
    };
  }
  if (mode === "edit" && isRevertLatestRequest(payload?.messages)) {
    const reverted = await revertLatestArcBotEdit();
    return reverted.ok
      ? { ok: true, text: reverted.reply || "Reverted the latest ArcBot edit." }
      : { ok: false, needsAuth: false, error: reverted.error || "ArcBot revert failed." };
  }
  const roots = await getCodexAssistantProjectRoots({ ensureLocalRoot: true });
  const activeContext = payload?.activeContext && typeof payload.activeContext === "object"
    ? payload.activeContext
    : null;
  const targetPath = getAssistantTargetJsonPath(activeContext);
  let activeJson = null;
  const activeJsonFallback = activeContext?.activeJson != null &&
    typeof activeContext.activeJson === "object" &&
    !Array.isArray(activeContext.activeJson)
    ? activeContext.activeJson
    : null;
  if (targetPath) {
    const validation = await validateArcBotJsonTarget(targetPath);
    if (validation.ok) {
      if (activeJsonFallback) {
        activeJson = activeJsonFallback;
      } else {
        try {
          activeJson = JSON.parse(fs.readFileSync(validation.targetPath, "utf8"));
        } catch (err) {
          activeJson = {
            error: "Active JSON file exists but could not be parsed or read.",
            detail: String(err?.message || err || ""),
          };
        }
      }
    } else if (!validation.ok) {
      activeJson = activeJsonFallback || { error: validation.error };
    }
  } else if (activeJsonFallback) {
    activeJson = activeJsonFallback;
  }
  let editSession = null;
  const activeJsonIsError = activeJson &&
    typeof activeJson.error === "string" &&
    !Object.prototype.hasOwnProperty.call(activeJson, "ratio pattern");
  if (mode === "edit" && targetPath && activeJson && !activeJsonIsError) {
    const validation = await validateArcBotJsonTarget(targetPath);
    if (validation.ok) {
      editSession = createArcBotEditSession({ targetPath: validation.targetPath, activeJson });
    }
  }
  const codexCwd = editSession?.sessionDir || roots.cliRoot;
  const codexSandbox = editSession ? "workspace-write" : "read-only";
  const prompt = clampCodexPrompt(
    buildAssistantPrompt(
      payload?.messages,
      mode,
      roots.projectRoot,
      codexCwd,
      roots.networkRoot,
      activeContext,
      activeJson,
      editSession
    )
  );
  const result = await runCodexCommand([
    "exec",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    codexSandbox,
    "--skip-git-repo-check",
    "--cd",
    codexCwd,
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
  const rawText = String(result.stdout || "").trim();
  if (mode === "edit") {
    if (editSession) {
      let editedJson = null;
      let editedText = "";
      try {
        editedText = fs.readFileSync(editSession.jsonPath, "utf8");
        editedJson = JSON.parse(editedText);
      } catch (err) {
        const message = String(err?.message || err || "Edited JSON copy could not be read.");
        return { ok: false, needsAuth: false, error: `ArcBot could not apply the temp JSON copy. ${message}` };
      }
      if (sha256Text(editedText) !== editSession.beforeSha256) {
        const structured = extractJsonObject(rawText);
        const applied = await applyArcBotJsonEdit({
          targetPath: editSession.targetPath,
          replacementJson: editedJson,
          requestText: String((payload?.messages || []).slice(-1)[0]?.content || ""),
          reply: structured?.reply || rawText,
          originalJson: activeJson,
        });
        return applied.ok
          ? {
              ok: true,
              text: `${applied.reply || "Updated the active JSON file."}\n\nBackup: ${applied.backupPath}`,
              editApplied: true,
              targetPath: applied.targetPath,
              backupPath: applied.backupPath,
            }
          : { ok: false, needsAuth: false, error: applied.error || "ArcBot JSON edit failed." };
      }
    }
    const structured = extractJsonObject(rawText);
    if (structured?.action === "answer" || structured?.action === "edited" || structured?.action === "no_edit") {
      return {
        ok: true,
        text: String(structured.reply || "").trim() || "No response.",
      };
    }
  }
  return {
    ok: true,
    text: rawText,
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
ipcMain.handle("get-windows-user-name", () => {
  const envUser = String(process.env.USERNAME || process.env.USER || "").trim();
  if (envUser) return envUser;
  try {
    return String(os.userInfo()?.username || "").trim();
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
