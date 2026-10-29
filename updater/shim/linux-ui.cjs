// Kimi for Linux UI fixes (loaded by linux-shim.cjs before the original main).
//  1. Overlay views (work/chat surface tip card, etc.) are WebContentsViews stacked over the main kimi-agent view.
//     On Linux, Chromium unions every view's -webkit-app-region:drag rectangles at the window level, so clicks on an
//     overlay that sits over the host's title/drag bars (win-titlebar-drag, home-drag-bar) start a window move instead
//     of reaching the overlay -> its X button "does nothing". We carve matching no-drag holes into the host page.
//  2. Escape (in the host or the tip) closes the surface tip; frameless popup BrowserWindows close/hide on Escape.
'use strict';
if (process.platform === 'linux') {
  const { app, BaseWindow, BrowserWindow } = require('electron');
  const dbg = (...a) => { if (process.env.KIMI_LINUX_DEBUG) console.error('[kimi-linux-ui]', ...a); };
  const isTip = (wc) => { try { return /\/work-surface-tip\.html/.test(wc.getURL()); } catch { return false; } };
  const alive = (wc) => wc && !wc.isDestroyed();
  const HOLE = (rects) => `(()=>{try{const id='__kimi_linux_nodrag';let r=document.getElementById(id);
    if(!r){r=document.createElement('div');r.id=id;r.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';(document.body||document.documentElement).appendChild(r);}
    r.replaceChildren(...${JSON.stringify(rects)}.map(b=>{const d=document.createElement('div');d.style.cssText='position:fixed;pointer-events:none;-webkit-app-region:no-drag;app-region:no-drag;left:'+b.x+'px;top:'+b.y+'px;width:'+b.width+'px;height:'+b.height+'px';return d;}));return 1}catch(e){return String(e)}})()`;
  const last = new WeakMap();
  const sync = () => {
    for (const w of BaseWindow.getAllWindows()) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      const kids = (w.contentView && w.contentView.children) || []; if (kids.length < 2) continue;
      const [cw, ch] = w.getContentSize();
      kids.forEach((host, i) => {
        if (!host.webContents || !alive(host.webContents) || !host.getVisible || !host.getVisible()) return;
        const hb = host.getBounds(); if (hb.width < cw * 0.6 || hb.height < ch * 0.6) return; // only full-size hosts carry title/drag bars
        const rects = [];
        for (const o of kids.slice(i + 1)) {
          if (!o.getVisible || !o.getVisible()) continue;
          const b = o.getBounds(); if (b.width >= cw * 0.95 && b.height >= ch * 0.95) continue; // full-size sibling pages are not overlays
          if (b.width <= 0 || b.height <= 0) continue;
          rects.push({ x: b.x - hb.x, y: b.y - hb.y, width: b.width, height: b.height });
        }
        const key = JSON.stringify(rects); if (last.get(host.webContents) === key) return;
        last.set(host.webContents, key);
        host.webContents.executeJavaScript(HOLE(rects), true).then((r) => dbg('no-drag holes', host.webContents.id, key, r)).catch(() => last.delete(host.webContents));
      });
    }
  };
  const closeTips = () => { let n = 0; for (const w of BaseWindow.getAllWindows()) for (const v of (w.contentView && w.contentView.children) || []) {
    if (v.webContents && alive(v.webContents) && isTip(v.webContents) && v.getVisible()) { n++; v.webContents.executeJavaScript('window.workSurfaceTipAPI&&window.workSurfaceTipAPI.close()', true).catch(() => {}); } } return n; };
  const esc = (i) => i.type === 'keyDown' && i.key === 'Escape' && !i.alt && !i.control && !i.meta;
  app.on('web-contents-created', (_e, wc) => {
    wc.on('did-finish-load', () => { const h = wc.hostWebContents; void h; for (const w of BaseWindow.getAllWindows()) if (!w.isDestroyed()) last.delete(wc); });
    wc.on('before-input-event', (ev, input) => {
      if (!esc(input)) return;
      if (isTip(wc)) { ev.preventDefault(); wc.executeJavaScript('window.workSurfaceTipAPI&&window.workSurfaceTipAPI.close()', true).catch(() => {}); return; }
      if (closeTips()) { ev.preventDefault(); return; }
      // frameless, non-main popup windows (pins, indicators, permission flow, ...) get an Escape close path
      const bw = BrowserWindow.fromWebContents(wc); if (!bw || bw.isDestroyed()) return;
      const url = wc.getURL();
      if (/\/(zoom-indicator|selection-toolbar|permission-flow|capture-pin|widget-pin)\.html/.test(url)) { dbg('escape closes', url); setTimeout(() => { try { /widget-pin|capture-pin/.test(url) ? bw.close() : bw.hide(); } catch {} }, 0); }
    });
  });

  // 3. Window controls (titleBarOverlay) contrast: the app hard-codes symbolColor per surface (Chat -> #FFFFFF), which
  //    renders white-on-white (invisible min/max/close) when the Chat page is light. Pick the symbol color from the
  //    actual pixels under the controls.
  const P = BaseWindow.prototype, origTBO = P.setTitleBarOverlay, tbo = new WeakMap();
  if (typeof origTBO === 'function') P.setTitleBarOverlay = function (o) { try { tbo.set(this, Object.assign({}, tbo.get(this), o)); } catch {} return origTBO.call(this, o); };
  let busy = false;
  const contrast = async () => {
    if (busy) return; busy = true;
    try { for (const w of BaseWindow.getAllWindows()) {
      const o = tbo.get(w); if (!o || w.isDestroyed() || !w.isVisible() || w.isMinimized()) continue;
      const [cw, ch] = w.getContentSize(); const h = Math.max(8, Math.min(o.height || 32, 60));
      const top = ((w.contentView && w.contentView.children) || []).filter((v) => v.webContents && alive(v.webContents) && v.getVisible() && v.getBounds().width >= cw * 0.6 && v.getBounds().height >= ch * 0.6).pop();
      if (!top) continue; const b = top.getBounds();
      const img = await top.webContents.capturePage({ x: Math.max(0, cw - 160 - b.x), y: Math.max(0, -b.y), width: 160, height: h });
      const bm = img.toBitmap(); if (!bm.length) continue; let sum = 0, n = 0;
      for (let i = 0; i < bm.length; i += 16) { sum += 0.0722 * bm[i] + 0.7152 * bm[i + 1] + 0.2126 * bm[i + 2]; n++; } // BGRA
      const want = sum / n > 140 ? '#000000' : '#FFFFFF';
      if (String(o.symbolColor || '').toUpperCase() !== want) { dbg('titlebar symbolColor', o.symbolColor, '->', want); o.symbolColor = want; origTBO.call(w, Object.assign({}, o)); }
    } } catch (e) { dbg('contrast', String(e)); } finally { busy = false; }
  };
  app.whenReady().then(() => { setInterval(sync, 250).unref(); setInterval(contrast, 1000).unref(); });
}
if (process.env.KIMI_LINUX_TEST_HOOKS === '1' && process.env.KIMI_LINUX_INSPECT) require('inspector').open(+process.env.KIMI_LINUX_INSPECT, '127.0.0.1');
