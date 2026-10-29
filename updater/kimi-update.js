#!/usr/bin/env node
// Kimi desktop for Linux — per-user updater. Run with the bundled Electron in node mode (run-update.sh).
//   --check | --stage [--json] [--feed URL] [--current V] [--from-file setup.exe] | --rollback | --prune
// Feed: Moonshot's official electron-updater generic feed (latest.yml); the setup .exe is verified by sha512+size
// from latest.yml, unpacked with 7zz and rebuilt into app-<ver>/ on the matching official Electron Linux runtime.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const C = require('./upd-core.js');
const args = process.argv.slice(2); C.json = args.includes('--json');
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ROOT = process.env.KIMI_DESKTOP_ROOT || path.dirname(__dirname);
const UPD = path.join(ROOT, 'updater');
const CACHE = process.env.KIMI_UPDATE_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'kimi-desktop-updater');
const DEFAULT_FEED = 'https://kimi-img.moonshot.cn/app/upgrade/';
const BIN = 'kimi-desktop';

function feedUrl() {
  let u = opt('--feed') || process.env.KIMI_UPDATE_URL;
  if (!u) { const vs = C.installedVersions(ROOT); const y = vs.length && path.join(ROOT, `app-${vs[vs.length - 1]}`, 'resources', 'app-update.yml');
    if (y && fs.existsSync(y)) { const m = fs.readFileSync(y, 'utf8').match(/^url:\s*(\S+)/m); if (m) u = m[1]; } }
  u = u || DEFAULT_FEED; return u.endsWith('/') ? u : u + '/';
}
function parseLatest(t) {
  const g = (k) => { const m = t.match(new RegExp('^' + k + ":\\s*'?([^'\\n]*)'?\\s*$", 'm')); return m ? m[1].trim() : null; };
  const o = { version: g('version'), path: g('path'), sha512: g('sha512'), releaseDate: g('releaseDate'), files: [] };
  const fm = t.match(/^files:\n((?:[ \t]+.*\n?)*)/m);
  if (fm) for (const blk of fm[1].split(/\n\s*-\s+/).map((s) => s.replace(/^\s*-\s+/, ''))) {
    const f = {}; for (const l of blk.split('\n')) { const m = l.match(/^\s*(url|sha512|size):\s*(\S+)/); if (m) f[m[1]] = m[1] === 'size' ? +m[2] : m[2]; } if (f.url) o.files.push(f); }
  const rn = t.match(/^releaseNotes:\s*\|-?\n((?:[ \t]+.*\n?|\n)*)/m); if (rn) o.releaseNotes = rn[1].replace(/^ {2}/gm, '').trim();
  if (!o.version || !/^\d+(\.\d+)+$/.test(o.version)) throw new Error('bad latest.yml (version)');
  const f = o.files.find((x) => /\.exe$/i.test(x.url)) || { url: o.path, sha512: o.sha512 };
  if (!f.url || !f.sha512) throw new Error('bad latest.yml (files)');
  o.file = f; return o;
}
function current() { if (opt('--current')) return opt('--current'); const vs = C.installedVersions(ROOT); return vs[vs.length - 1] || '0.0.0'; }

function electronVersionOf(exe) {
  const fd = fs.openSync(exe, 'r'); const sz = fs.fstatSync(fd).size, chunk = 16 << 20, re = /Electron\/(\d+\.\d+\.\d+)/; let pos = 0, prev = '';
  try { while (pos < sz) { const b = Buffer.alloc(Math.min(chunk, sz - pos)); fs.readSync(fd, b, 0, b.length, pos); const s = prev + b.toString('latin1'); const m = s.match(re); if (m) return m[1]; prev = s.slice(-64); pos += b.length; } }
  finally { fs.closeSync(fd); }
  throw new Error('cannot detect Electron version in ' + exe);
}
function sh(cmd, a, o = {}) { const r = cp.spawnSync(cmd, a, Object.assign({ stdio: ['ignore', 'ignore', 'pipe'] }, o)); if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} failed: ${r.stderr}`); }
const W = (f, s, mode = 0o755) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, { mode }); fs.chmodSync(f, mode); };

// ---- resources/resources: Windows -> Linux --------------------------------------------------------------
const NODE_WRAP = (script) => `#!/bin/sh
# Kimi bundled Node runtime (Linux port of the .cmd shim): the app's Electron in node mode.
D=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
N="\${KIMI_DESKTOP_RUNTIME_NODE:-\${DAIMON_BUNDLE_NODE_BIN:-}}"; [ -x "$N" ] || N=
# never re-exec one of these wrappers (DAIMON_BUNDLE_NODE_BIN often points back at this script -> infinite exec loop)
case "$(readlink -f "$N" 2>/dev/null)" in ""|"$D"/*) N="$D/../../../${BIN}";; esac
export ELECTRON_RUN_AS_NODE=1
exec "$N" ${script ? '"$D/npm.asar/' + script + '" ' : ''}"$@"
`;
const WINE_WRAP = (name) => `#!/bin/sh
# ${name} is only published by Moonshot as a Windows console program; run it through Wine (dnf install wine-core).
EXE="\${KIMI_WINE_TOOLS:-\${KIMI_DESKTOP_ROOT:-$HOME/.local/opt/kimi-desktop}/wine-tools}/${name}.exe"
[ -f "$EXE" ] || { echo "${name}: $EXE missing (run kimi-desktop once)" >&2; exit 127; }
command -v wine >/dev/null 2>&1 || { echo "${name} needs Wine on Linux: sudo dnf install wine-core wine-core.i686 (or wine)" >&2; exit 127; }
export WINEPREFIX="\${KIMI_WINEPREFIX:-\${XDG_DATA_HOME:-$HOME/.local/share}/kimi-desktop/wine}" WINEDEBUG="\${WINEDEBUG:--all}"
[ -d "$WINEPREFIX" ] || WINEDLLOVERRIDES="mscoree,mshtml=" wineboot -i >/dev/null 2>&1
exec wine "$EXE" "$@"
`;
async function webbridge(rr, zzOut) {
  const vf = path.join(rr, 'kimi-webbridge.bundle-version'); if (!fs.existsSync(vf)) return 'absent';
  const v = fs.readFileSync(vf, 'utf8').trim(); const base = `https://cdn.kimi.com/webbridge/${v}/`;
  let sha = null; try { const j = JSON.parse((await C.request(base + 'version.json')).toString()); const s = JSON.stringify(j); const m = s.match(/linux-amd64[^}]*?"(?:sha256|checksum)"\s*:\s*"(?:sha256:)?([0-9a-f]{64})"/); if (m) sha = m[1]; } catch {}
  const pins = JSON.parse(fs.readFileSync(path.join(UPD, 'runtime-pins.json'), 'utf8'));
  if (!sha && pins.webbridge && pins.webbridge[v]) sha = pins.webbridge[v];
  if (!sha) throw new Error('no checksum for kimi-webbridge ' + v);
  const f = await C.fetchVerified(base + 'releases/kimi-webbridge-linux-amd64', path.join(CACHE, 'webbridge', v, 'kimi-webbridge'), { digest: sha });
  fs.copyFileSync(f, path.join(rr, 'kimi-webbridge')); fs.chmodSync(path.join(rr, 'kimi-webbridge'), 0o755); return v;
}
async function koffi(rr) {
  const d = path.join(rr, 'native', 'koffi'); if (!fs.existsSync(path.join(d, 'package.json'))) return 'absent';
  const v = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version;
  const meta = JSON.parse((await C.request(`https://registry.npmjs.org/koffi/${v}`)).toString());
  const integ = meta.dist.integrity.replace(/^sha512-/, '');
  const tgz = await C.fetchVerified(meta.dist.tarball, path.join(CACHE, 'npm', `koffi-${v}.tgz`), { algo: 'sha512', enc: 'base64', digest: integ });
  const t = fs.mkdtempSync(path.join(CACHE, 'koffi-')); try {
    sh('tar', ['-xzf', tgz, '-C', t, 'package/build/koffi/linux_x64/koffi.node']);
    fs.mkdirSync(path.join(d, 'build', 'koffi', 'linux_x64'), { recursive: true });
    fs.copyFileSync(path.join(t, 'package/build/koffi/linux_x64/koffi.node'), path.join(d, 'build/koffi/linux_x64/koffi.node'));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
  return v;
}
async function daimon(rr) {
  const tb = path.join(rr, 'daimon-bundle.tar.gz'); if (!fs.existsSync(tb)) return 'absent';
  const pins = JSON.parse(fs.readFileSync(path.join(UPD, 'runtime-pins.json'), 'utf8'));
  const uv = await C.fetchVerified(pins.uv.url, path.join(CACHE, 'runtime', path.basename(pins.uv.url)), { digest: pins.uv.sha256 });
  const py = await C.fetchVerified(pins.python.url, path.join(CACHE, 'runtime', decodeURIComponent(path.basename(pins.python.url))), { digest: pins.python.sha256 });
  const w = fs.mkdtempSync(path.join(CACHE, 'daimon-')); const b = path.join(w, 'b');
  try {
    fs.mkdirSync(b); sh('tar', ['-xzf', tb, '-C', b]);
    const stampF = path.join(b, '.daimon-bundle-stamp'); const old = fs.existsSync(stampF) ? fs.readFileSync(stampF, 'utf8').trim() : fs.readFileSync(tb + '.stamp', 'utf8').trim();
    const stamp = old.replace('win32-x64', 'linux-x64') + '-linux1';
    // Windows-only payload out
    fs.rmSync(path.join(b, 'runtime'), { recursive: true, force: true });
    for (const f of fs.readdirSync(path.join(b, 'bin'))) if (/\.(cmd|ps1|exe|bat)$/i.test(f)) fs.rmSync(path.join(b, 'bin', f));
    const np = path.join(b, 'app', 'daimon', 'node_modules', 'node-pty');
    if (fs.existsSync(np)) { fs.rmSync(path.join(np, 'prebuilds', 'win32-x64'), { recursive: true, force: true }); fs.rmSync(path.join(np, 'build'), { recursive: true, force: true });
      fs.mkdirSync(path.join(np, 'prebuilds', 'linux-x64'), { recursive: true }); fs.copyFileSync(path.join(UPD, pins.nodePty.file), path.join(np, 'prebuilds', 'linux-x64', 'pty.node'));
      const helper = path.join(UPD, 'assets', 'spawn-helper');
      if (fs.existsSync(helper)) { const dest = path.join(np, 'prebuilds', 'linux-x64', 'spawn-helper'); fs.copyFileSync(helper, dest); fs.chmodSync(dest, 0o755); }
    }
    // Linux runtimes (uv + standalone CPython; git comes from the system)
    fs.mkdirSync(path.join(b, 'runtime', 'uv'), { recursive: true }); sh('tar', ['-xzf', uv, '-C', path.join(b, 'runtime', 'uv'), '--strip-components=1']);
    fs.mkdirSync(path.join(b, 'runtime', 'python'), { recursive: true }); sh('tar', ['-xzf', py, '-C', path.join(b, 'runtime', 'python')]);
    fs.renameSync(path.join(b, 'runtime', 'python', 'python'), path.join(b, 'runtime', 'python', 'cpython-3.12'));
    // Faithful POSIX ports of kimi-daimon.ps1 / daimon.ps1 (--node <path> parsing, prepare|start|serve|control|runtime|cli verbs)
    const nodeArg = `D=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
NODE="\${DAIMON_BUNDLE_NODE_BIN:-\${DAIMON_NODE_BIN:-\${KIMI_DESKTOP_RUNTIME_NODE:-}}}"
case "\${1:-}" in
  --node|--node-bin) [ $# -ge 2 ] || { echo "Daimon bundle launcher expected a value after $1." >&2; exit 64; }; NODE=$2; shift 2;;
  --node=*) NODE=\${1#--node=}; shift;; --node-bin=*) NODE=\${1#--node-bin=}; shift;;
esac
[ -n "$NODE" ] || NODE=$(command -v node || true)
[ -n "$NODE" ] || { echo "Daimon bundle requires Node v24.15.0. Pass --node <path> or set DAIMON_BUNDLE_NODE_BIN." >&2; exit 127; }
case "$NODE" in */*) [ -e "$NODE" ] && NODE=$(readlink -f "$NODE");; *) NODE=$(command -v "$NODE" || true);; esac
[ -n "$NODE" ] && [ -x "$NODE" ] || { echo "Daimon bundle Node command was not found." >&2; exit 127; }
export DAIMON_BUNDLE_NODE_BIN="$NODE" ELECTRON_RUN_AS_NODE=1 DAIMON_BUNDLE_ROOT="$D"
export PATH="$(dirname "$NODE"):$D/runtime/uv:$D/runtime/python/cpython-3.12/bin:$PATH"
`;
    const bj = JSON.parse(fs.readFileSync(path.join(b, 'bundle.json'), 'utf8'));
    W(path.join(b, 'bin', 'kimi-daimon'), `#!/bin/sh
# kimi-daimon (Linux port of kimi-daimon.ps1)
${nodeArg}export DAIMON_UV_PATH="$D/runtime/uv/uv" DAIMON_PYTHON_BASE_PATH="$D/runtime/python/cpython-3.12/bin/python3"
export DAIMON_RUNTIME_BINARY_PATH="$D/bin/kimi-daimon" DAIMON_ADAPTER_PACKAGE_ROOT="$D/app/daimon"
exec "$NODE" "$D/app/daimon/dist/src/runner/cli.js" "$@"
`);
    W(path.join(b, 'bin', 'daimon'), `#!/bin/sh
# daimon (Linux port of daimon.ps1)
${nodeArg}while [ $# -gt 0 ]; do
  if [ "$1" = --background-python-sync ]; then export DAIMON_PYTHON_RUNTIME_BACKGROUND_SYNC=1; shift; continue; fi
  [ "$1" = -- ] && shift; break
done
K="$D/bin/kimi-daimon"; REL="$D/release/manifest.json"
SHARE="\${KIMI_SHARE_DIR:-$HOME/.kimi}"; export DAIMON_CONFIG_PATH="\${DAIMON_CONFIG_PATH:-$SHARE/daimon/config.json}"
key() { "$NODE" -e 'const fs=require("node:fs");let c;try{c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(1)}const p=c?.model?.providers?.["daimon-kimi-code"];const k=c?.credentials?.kimiCode?.apiKey??p?.apiKey;process.exit(typeof k==="string"&&k.trim().length>0?0:1)' "$DAIMON_CONFIG_PATH"; }
CMD=\${1:-start}; [ $# -gt 0 ] && shift
case "$CMD" in
  prepare) exec "$K" setup --release "$REL" --no-daemon --skip-webbridge --skip-system-tools "$@";;
  start|serve)
    if [ ! -e "$DAIMON_CONFIG_PATH" ] || [ "\${DAIMON_BUNDLE_FORCE_SETUP:-}" = 1 ]; then "$K" setup --release "$REL" --no-daemon --skip-webbridge --skip-system-tools || exit $?; fi
    if key; then exec "$K" start --control "$@"; fi; exec "$K" control serve "$@";;
  control) exec "$K" control serve "$@";;
  runtime) exec "$K" start --control "$@";;
  cli) exec "$K" "$@";;
  *) exec "$K" "$CMD" "$@";;
esac
`);
    bj.platform = 'linux-x64'; bj.runtimes = Object.assign({}, bj.runtimes, { uv: { path: 'runtime/uv/uv' }, git: { bundled: false, gitPath: 'git (system)' }, python: Object.assign({}, (bj.runtimes || {}).python, { asset: decodeURIComponent(path.basename(pins.python.url)), sha256: pins.python.sha256, path: 'runtime/python/cpython-3.12' }) }); bj.entrypoints = Object.fromEntries(Object.entries(bj.entrypoints || { daimon: 1, kimiDaimon: 1 }).map(([k, v]) => [k, String(v).replace(/\.(cmd|ps1)$/i, '')]));
    fs.writeFileSync(path.join(b, 'bundle.json'), JSON.stringify(bj, null, 2));
    fs.writeFileSync(stampF, stamp); for (const m of ['.daimon-bundle-extracted']) fs.rmSync(path.join(b, m), { force: true });
    fs.rmSync(tb); sh('tar', ['-czf', tb, '-C', b, '.']); fs.writeFileSync(tb + '.stamp', stamp);
    // the app's DaimonExtract only runs on win32: ship the bundle pre-extracted where it expects it (resources/resources/daimon-bundle)
    const ex = path.join(rr, 'daimon-bundle'); fs.rmSync(ex, { recursive: true, force: true }); sh('cp', ['-a', b, ex]);
    return stamp;
  } finally { fs.rmSync(w, { recursive: true, force: true }); }
}

async function buildFromApp(appSrc, ver, zz) {
  const exe = fs.readdirSync(appSrc).find((f) => /^kimi\.exe$/i.test(f)); if (!exe) throw new Error('Kimi.exe not in package');
  const eVer = electronVersionOf(path.join(appSrc, exe));
  const tmp = path.join(ROOT, `app-${ver}.tmp`); fs.rmSync(tmp, { recursive: true, force: true });
  C.emit({ status: 'downloading', version: ver, step: 'electron ' + eVer });
  C.x7z(zz, await C.electron(eVer, path.join(CACHE, 'electron'), zz), tmp);
  fs.renameSync(path.join(tmp, 'electron'), path.join(tmp, BIN));
  fs.rmSync(path.join(tmp, 'resources', 'default_app.asar'), { force: true });
  const R = path.join(tmp, 'resources'), A = path.join(R, 'app');
  C.emit({ status: 'installing', version: ver, step: 'app.asar' });
  C.extractAsar(path.join(appSrc, 'resources', 'app.asar'), A);
  const un = C.unpackedSet(path.join(appSrc, 'resources', 'app.asar.unpacked'));
  for (const f of ['linux-entry.mjs', 'linux-shim.cjs', 'linux-ui.cjs']) fs.copyFileSync(path.join(UPD, 'shim', f), path.join(A, 'out', 'main', f));
  const pj = JSON.parse(fs.readFileSync(path.join(A, 'package.json'), 'utf8'));
  if (pj.version !== ver) throw new Error(`package.json version ${pj.version} != feed version ${ver}`);
  pj.main = 'out/main/linux-entry.mjs'; fs.writeFileSync(path.join(A, 'package.json'), JSON.stringify(pj, null, 2));
  // route electron-updater's autoUpdater to the Linux updater (anchor = destructuring of autoUpdater/NsisUpdater)
  const idx = path.join(A, 'out', 'main', 'index.js'); let s = fs.readFileSync(idx, 'utf8');
  const re = /const\s*\{\s*autoUpdater:\s*(_0x[0-9a-f]+),\s*NsisUpdater:\s*(_0x[0-9a-f]+)\s*\}\s*=\s*(_0x[0-9a-f]+)\s*,/;
  const hooked = re.test(s);
  if (hooked) { s = s.replace(re, (m0, a, n, src) => `const ${a} = (process.platform === "linux" && globalThis.__kimiLinuxUpdater) || ${src}.autoUpdater, ${n} = ${src}.NsisUpdater,`); fs.writeFileSync(idx, s); }
  else C.log('WARNING: autoUpdater anchor not found; in-app updates fall back to timer/CLI');
  for (const f of ['linux-shim.cjs', 'linux-ui.cjs']) C.syntaxCheck(path.join(A, 'out', 'main', f));
  const chk = cp.spawnSync(path.join(tmp, BIN), ['--check', idx], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), encoding: 'utf8' });
  if (chk.status !== 0) throw new Error('patched index.js fails syntax check: ' + chk.stderr);
  C.packAsar(A, path.join(R, 'app.asar'), (r) => un.has(r) || /\.node$/.test(r));
  fs.rmSync(A, { recursive: true, force: true });
  const m = C.asarMain(path.join(tmp, BIN), path.join(R, 'app.asar')); if (m !== 'out/main/linux-entry.mjs') throw new Error('repacked asar main is ' + m);
  fs.copyFileSync(path.join(appSrc, 'resources', 'app-update.yml'), path.join(R, 'app-update.yml'));
  // extra resources
  C.emit({ status: 'installing', version: ver, step: 'resources' });
  const RR = path.join(R, 'resources'); C.cpR(path.join(appSrc, 'resources', 'resources'), RR);
  const wine = path.join(RR, 'wine'); fs.mkdirSync(wine, { recursive: true }); const wineTools = [];
  for (const t of ['kimi-slides', 'kimiim-cli']) if (fs.existsSync(path.join(RR, t + '.exe'))) { fs.renameSync(path.join(RR, t + '.exe'), path.join(wine, t + '.exe')); W(path.join(RR, t), WINE_WRAP(t)); wineTools.push(t); }
  const rt = path.join(RR, 'runtime');
  if (fs.existsSync(rt)) { for (const f of fs.readdirSync(rt)) if (/\.(cmd|ps1|bat|exe)$/i.test(f)) fs.rmSync(path.join(rt, f));
    W(path.join(rt, 'node'), NODE_WRAP(null)); W(path.join(rt, 'npm'), NODE_WRAP('bin/npm-cli.js')); W(path.join(rt, 'npx'), NODE_WRAP('bin/npx-cli.js'));
    W(path.join(rt, 'node-gyp'), NODE_WRAP('node_modules/node-gyp/bin/node-gyp.js')); }
  for (const f of fs.readdirSync(RR)) if (/\.exe$/i.test(f)) fs.rmSync(path.join(RR, f));
  const wb = await webbridge(RR); const kf = await koffi(RR);
  C.emit({ status: 'installing', version: ver, step: 'daimon bundle' });
  const dm = await daimon(RR);
  for (const f of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) if (fs.existsSync(path.join(appSrc, f))) fs.copyFileSync(path.join(appSrc, f), path.join(tmp, f + '.win'));
  fs.writeFileSync(path.join(tmp, 'linux-build.json'), JSON.stringify({ version: ver, electron: eVer, updaterHooked: hooked, webbridge: wb, koffi: kf, daimon: dm, wineTools, built: new Date().toISOString() }, null, 2));
  const got = C.smoke(path.join(tmp, BIN)); if (got !== eVer) throw new Error(`electron ${got} != ${eVer}`);
  return tmp;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  if (args.includes('--rollback')) return rollback();
  if (args.includes('--prune')) return prune();
  const cur = current(); const local = opt('--from-file');
  let o;
  if (local) { o = { version: opt('--version'), file: { url: local } }; if (!o.version || !/^\d+(\.\d+)+$/.test(o.version)) throw new Error('--from-file needs a numeric --version'); }
  else { C.emit({ status: 'checking', current: cur }); const feed = feedUrl(); o = parseLatest((await C.request(feed + 'latest.yml')).toString()); o.feed = feed; }
  const meta = { version: o.version, releaseNotes: o.releaseNotes, releaseDate: o.releaseDate };
  if (!local && C.vcmp(o.version, cur) <= 0) { C.emit(Object.assign({ status: 'up_to_date' }, meta, { version: cur, latest: o.version })); return; }
  if (args.includes('--check')) { C.emit(Object.assign({ status: C.installedVersions(ROOT).includes(o.version) ? 'ready_to_install' : 'available' }, meta)); return; }
  C.lock(ROOT);
  if (C.installedVersions(ROOT).includes(o.version)) { C.emit(Object.assign({ status: 'ready_to_install' }, meta)); return; }
  let setup;
  if (local) setup = local;
  else {
    const u = new URL(o.file.url, o.feed).href; let lastP = -1;
    C.emit({ status: 'downloading', version: o.version, percent: 0 });
    setup = await C.fetchVerified(u, path.join(CACHE, 'pending', `Kimi-Setup-${o.version}.exe`), { algo: 'sha512', enc: 'base64', digest: o.file.sha512, size: o.file.size,
      onProgress: (g, t) => { const tot = t || o.file.size || 0; const p = tot ? Math.floor(g * 100 / tot) : 0; if (p !== lastP) { lastP = p; C.emit({ status: 'downloading', version: o.version, percent: p, transferred: g, total: tot }); } } });
    C.emit({ status: 'downloading', version: o.version, percent: 100 });
  }
  const zz = C.sevenZip(ROOT); const work = fs.mkdtempSync(path.join(CACHE, 'work-'));
  try {
    C.emit({ status: 'installing', version: o.version, step: 'unpack' });
    C.x7z(zz, setup, path.join(work, 'nsis'), ['$PLUGINSDIR/app-64.7z']);
    const a7 = path.join(work, 'nsis', '$PLUGINSDIR', 'app-64.7z'); if (!fs.existsSync(a7)) throw new Error('app-64.7z not in installer');
    C.x7z(zz, a7, path.join(work, 'app')); fs.rmSync(path.join(work, 'nsis'), { recursive: true, force: true });
    const tmp = await buildFromApp(path.join(work, 'app'), o.version, zz);
    if (C.installedVersions(ROOT).includes(cur)) {
      for (const d of fs.readdirSync(ROOT)) if (d.startsWith('rollback-')) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
      cp.execFileSync('cp', ['-al', path.join(ROOT, `app-${cur}`), path.join(ROOT, `rollback-${cur}`)]);
    }
    C.commit(ROOT, tmp, o.version);
    if (!local) fs.rmSync(path.join(CACHE, 'pending'), { recursive: true, force: true });
    C.emit(Object.assign({ status: 'ready_to_install' }, meta));
  } catch (e) { fs.rmSync(path.join(ROOT, `app-${o.version}.tmp`), { recursive: true, force: true }); throw e; }
  finally { fs.rmSync(work, { recursive: true, force: true }); }
}
// remove superseded app-* dirs that are not running (a rollback-<v> copy is kept by --stage)
function prune() {
  try { C.lock(ROOT); } catch (e) { C.emit({ status: 'prune_skipped', reason: String(e.message || e) }); return; }  // never race a running --stage
  const vs = C.installedVersions(ROOT); const keep = vs[vs.length - 1];
  for (const v of vs) if (v !== keep) { const d = path.join(ROOT, `app-${v}`);
    const busy = cp.spawnSync('pgrep', ['-u', String(process.getuid()), '-f', d + '/' + BIN], { encoding: 'utf8' }).stdout.trim(); if (!busy) fs.rmSync(d, { recursive: true, force: true }); }
  for (const d of fs.readdirSync(ROOT)) if (/^app-\d+(\.\d+)+(\.tmp|\.old-\d+)$/.test(d)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  C.emit({ status: 'pruned', keep });
}
function rollback() {
  C.lock(ROOT);
  const rb = fs.readdirSync(ROOT).find((d) => d.startsWith('rollback-')); if (!rb) throw new Error('no rollback copy');
  const v = rb.slice(9);
  if (!/^\d+(\.\d+)+$/.test(v)) throw new Error('invalid rollback version');
  for (const version of C.installedVersions(ROOT)) {
    const p = cp.spawnSync('pgrep', ['-u', String(process.getuid()), '-f', path.join(ROOT, 'app-' + version, BIN)], { encoding: 'utf8' });
    if ((p.status !== 0 && p.status !== 1) || String(p.stdout).trim().split(/\s+/).filter(Boolean).some(pid => Number(pid) !== process.pid)) throw new Error('close Kimi before rollback (or process check failed)');
  }
  for (const d of fs.readdirSync(ROOT)) if (/^app-/.test(d) && C.vcmp(d.slice(4), v) > 0) fs.renameSync(path.join(ROOT, d), path.join(ROOT, d + '.tmp'));
  if (!fs.existsSync(path.join(ROOT, `app-${v}`))) fs.renameSync(path.join(ROOT, rb), path.join(ROOT, `app-${v}`));
  for (const d of fs.readdirSync(ROOT)) if (/^app-\d+(\.\d+)+\.tmp$/.test(d)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  C.emit({ status: 'rolled_back', version: v });
}
main().catch((e) => { C.emit({ status: 'error', message: String(e.message || e) }); process.exit(1); });
