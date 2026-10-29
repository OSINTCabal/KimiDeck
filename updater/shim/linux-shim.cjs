// Linux integration for the Windows Kimi desktop build:
//  * globalThis.__kimiLinuxUpdater: electron-updater compatible object that drives updater/kimi-update.js
//    (latest.yml from Moonshot's official feed -> verified setup.exe -> rebuilt Linux app-<ver>/).
//  * CLI: `kimi-desktop --check-updates` (first or second instance).
'use strict';
const { app } = require('electron');
const path = require('path'), fs = require('fs'), cp = require('child_process'), EventEmitter = require('events');
const ROOT = process.env.KIMI_DESKTOP_ROOT || path.resolve(path.dirname(process.execPath), '..');
const UPD = path.join(ROOT, 'updater', 'kimi-update.js');
const LAUNCHER = process.env.KIMI_DESKTOP_LAUNCHER || path.join(ROOT, 'kimi-desktop.sh');

class KimiLinuxUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true; this.autoInstallOnAppQuit = false; this.disableWebInstaller = true;
    this.disableDifferentialDownload = true; this.forceDevUpdateConfig = false; this.allowPrerelease = false;
    this.logger = null; this.feed = process.env.KIMI_UPDATE_URL || null; this.pending = null; this.running = null; this.info = null;
    this.currentVersion = { version: app.getVersion() };
  }
  get available() { return fs.existsSync(UPD); }
  setFeedURL(o) { const u = typeof o === 'string' ? o : o && o.url; if (u && !process.env.KIMI_UPDATE_URL) this.feed = u; }
  _log(l, m) { try { this.logger && this.logger[l] && this.logger[l]('[linux-updater] ' + m); } catch {} if (process.env.KIMI_LINUX_DEBUG) console.error('[linux-updater]', m); }
  _run(mode) {
    if (this.running) return this.running;
    this.running = new Promise((resolve) => {
      const a = [UPD, mode, '--json', '--current', app.getVersion()]; if (this.feed) a.push('--feed', this.feed);
      let p; try { p = cp.spawn(process.execPath, a, { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', KIMI_DESKTOP_ROOT: ROOT }), stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { this.running = null; return resolve({ status: 'error', message: String(e) }); }
      let buf = '', last = null, err = '';
      p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); last = m; this._msg(m); } catch {} } });
      p.stderr.on('data', (d) => { err += d; this._log('info', String(d).trim()); });
      p.on('error', (e) => { last = { status: 'error', message: String(e) }; });
      p.on('close', (code) => { this.running = null; if (!last || (code !== 0 && last.status !== 'error')) last = { status: 'error', message: err.trim().split('\n').pop() || 'updater exited ' + code }; resolve(last); });
    });
    return this.running;
  }
  _msg(m) { if (m.status === 'downloading' && typeof m.percent === 'number') this.emit('download-progress', { percent: m.percent, transferred: m.transferred || 0, total: m.total || 0, bytesPerSecond: 0, delta: 0 }); }
  _info(r) { return { version: r.version, releaseNotes: r.releaseNotes || null, releaseName: r.releaseName || null, releaseDate: r.releaseDate || new Date().toISOString(), files: [], path: r.path || '', sha512: r.sha512 || '' }; }
  async checkForUpdates() {
    if (!this.available) return null;
    this.emit('checking-for-update');
    const r = await this._run('--check');
    if (r.status === 'error') { this.emit('error', new Error(r.message)); return null; }
    const info = this.info = this._info(r);
    if (r.status !== 'available' && r.status !== 'ready_to_install') { this.emit('update-not-available', info); return { isUpdateAvailable: false, updateInfo: info, versionInfo: info }; }
    this.emit('update-available', info);
    const downloadPromise = this.autoDownload ? this.downloadUpdate() : null;
    if (downloadPromise) downloadPromise.catch(() => {});
    return { isUpdateAvailable: true, updateInfo: info, versionInfo: info, downloadPromise };
  }
  async downloadUpdate() {
    const r = await this._run('--stage');
    if (r.status !== 'ready_to_install') { const e = new Error(r.message || 'update staging failed: ' + r.status); this.emit('error', e); throw e; }
    this.pending = r.version; const dir = path.join(ROOT, 'app-' + r.version);
    this.emit('update-downloaded', Object.assign({}, this.info || this._info(r), { version: r.version, downloadedFile: dir }));
    return [dir];
  }
  quitAndInstall() {
    this._log('info', 'restarting into ' + (this.pending || 'newest installed version'));
    this.emit('before-quit-for-update');
    const keep = process.argv.slice(1).filter((a) => !/^--(check-updates|enable-features=|ozone-platform|enable-wayland-ime|inspect)/.test(a) && !/^kimi(-work)?:/.test(a));
    try { app.relaunch({ execPath: fs.existsSync(LAUNCHER) ? LAUNCHER : process.execPath, args: keep }); } catch (e) { this._log('error', String(e)); }
    setImmediate(() => app.quit());
    setTimeout(() => app.exit(0), 8000).unref();
  }
  install() { return false; }
  isUpdaterActive() { return this.available; }
}
if (process.platform === 'linux') {
  const u = globalThis.__kimiLinuxUpdater = new KimiLinuxUpdater();
  const wants = (argv) => Array.isArray(argv) && argv.includes('--check-updates');
  app.on('second-instance', (_e, argv) => { if (wants(argv)) u.checkForUpdates().catch(() => {}); });
  if (wants(process.argv)) app.whenReady().then(() => setTimeout(() => u.checkForUpdates().catch(() => {}), 5000));
}
// test hook (only with KIMI_LINUX_TEST_HOOKS=1): SIGUSR2 -> the app's own "restart to update" IPC handler
if (process.platform === 'linux' && process.env.KIMI_LINUX_TEST_HOOKS === '1') {
  process.on('SIGUSR2', async () => {
    const { ipcMain, webContents, BrowserWindow } = require('electron');
    const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get('bridge:restart-to-update');
    console.error('[kimi-linux] test hook: restart-to-update handler', !!h, 'pending', globalThis.__kimiLinuxUpdater && globalThis.__kimiLinuxUpdater.pending);
    if (!h) return;
    const w = BrowserWindow.getAllWindows()[0]; const sender = (w && w.webContents) || webContents.getAllWebContents()[0];
    try { console.error('[kimi-linux] result', JSON.stringify(await h({ sender, senderFrame: sender && sender.mainFrame, frameId: 1, processId: sender && sender.getProcessId() }))); } catch (e) { console.error('[kimi-linux] hook error', e); }
  });
}
// Linux UI fixes (overlay close buttons vs. drag regions, Escape-to-close, title-bar control contrast)
try { require('./linux-ui.cjs'); } catch (e) { console.error('[kimi-linux] ui shim failed:', e); }
