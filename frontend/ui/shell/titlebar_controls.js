import { $, shell } from "./shell_context.js?v=20260510a";

let titlebarControlsWired = false;

export function initTitlebarControls() {
  if (titlebarControlsWired) return;
  const api = shell.getHostApi?.();
  const minBtn = $("titlebarMinBtn");
  const maxBtn = $("titlebarMaxBtn");
  const closeBtn = $("titlebarCloseBtn");
  const titlebar = $("customTitlebar");
  if (!minBtn && !maxBtn && !closeBtn && !titlebar) return;
  titlebarControlsWired = true;
  let dragRestoreArmed = false;
  let dragStartX = 0;
  let dragStartY = 0;

  minBtn?.addEventListener("click", (e) => { e.stopPropagation(); api?.minimizeWindow?.(); });
  maxBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!api?.isMaximized || !api?.restoreWindow) { api?.maximizeWindow?.(); return; }
    api.isMaximized().then((isMax) => { if (isMax) api.restoreWindow?.(); else api.maximizeWindow?.(); }).catch(() => api?.maximizeWindow?.());
  });
  closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); shell.shutdownApplication?.(); });
  titlebar?.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (target?.closest?.(".host-nodrag")) return;
    if (!api?.isMaximized) return;
    api.isMaximized().then((isMax) => { if (!isMax) return; dragRestoreArmed = true; dragStartX = e.clientX; dragStartY = e.clientY; }).catch(() => {});
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragRestoreArmed) return;
    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);
    if (dx < 5 && dy < 5) return;
    dragRestoreArmed = false;
    api?.restoreWindow?.();
  });
  window.addEventListener("mouseup", () => { dragRestoreArmed = false; });
  titlebar?.addEventListener("dblclick", (e) => {
    if (!api?.isMaximized || !api?.restoreWindow) return;
    const target = e.target;
    if (target?.closest?.(".host-nodrag")) return;
    api.isMaximized().then((isMax) => { if (isMax) api.restoreWindow?.(); else api.maximizeWindow?.(); }).catch(() => api?.maximizeWindow?.());
  });
}
