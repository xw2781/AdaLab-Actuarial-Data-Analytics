import {
  getBrowsingHistoryEntries,
  normalizeBrowsingHistoryEntry,
} from "/ui/shell/browsing_history.js";
import "/ui/shared/zoom_bridge.js?v=20260521a";

const MAX_ENTRIES = 15;

const listEl = document.getElementById("historyList");
const emptyEl = document.getElementById("historyEmpty");

window.ArcRhoZoomBridge?.wirePageZoomBridge();

function formatTimestamp(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return "";
  }
}

function postOpenDataset(entry) {
  const payload = { type: "arcrho:open-dataset-from-history", entry };
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, "*");
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function openEntry(entry) {
  const normalized = normalizeBrowsingHistoryEntry(entry);
  if (!normalized) return;

  if (postOpenDataset(normalized)) return;

  const params = new URLSearchParams();
  params.set("project", normalized.project);
  params.set("path", normalized.path);
  params.set("tri", normalized.tri);
  window.location.href = `/ui/dataset/dataset_viewer.html?${params.toString()}`;
}

function buildRow(entry, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "historyRow";
  row.dataset.historyIndex = String(index);
  row.title = `${entry.project} | ${entry.path} | ${entry.tri}`;

  const lineTop = document.createElement("div");
  lineTop.className = "lineTop";

  const projectEl = document.createElement("div");
  projectEl.className = "project";
  projectEl.textContent = entry.project;

  const triEl = document.createElement("div");
  triEl.className = "dataset";
  triEl.textContent = entry.tri;

  lineTop.appendChild(projectEl);
  lineTop.appendChild(triEl);

  const pathEl = document.createElement("div");
  pathEl.className = "path";
  pathEl.textContent = entry.path;

  const timeEl = document.createElement("div");
  timeEl.className = "time";
  timeEl.textContent = formatTimestamp(entry.ts);

  row.appendChild(lineTop);
  row.appendChild(pathEl);
  row.appendChild(timeEl);
  return row;
}

function render() {
  if (!listEl || !emptyEl) return;

  const entries = getBrowsingHistoryEntries({ maxEntries: MAX_ENTRIES });
  listEl.innerHTML = "";

  if (!entries.length) {
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";
  entries.forEach((entry, idx) => {
    listEl.appendChild(buildRow(entry, idx));
  });
}

listEl?.addEventListener("click", (e) => {
  const row = e.target?.closest?.(".historyRow");
  if (!row) return;
  const idx = Number(row.dataset.historyIndex || -1);
  if (!Number.isFinite(idx) || idx < 0) return;
  const entry = getBrowsingHistoryEntries({ maxEntries: MAX_ENTRIES })[idx];
  if (!entry) return;
  openEntry(entry);
});

window.addEventListener("message", (e) => {
  const type = String(e?.data?.type || "");
  if (type === "arcrho:browsing-history-updated" || type === "arcrho:tab-activated") {
    render();
  }
});

window.addEventListener("focus", () => render());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

render();
