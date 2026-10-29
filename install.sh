#!/bin/sh
set -eu
SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="${KIMI_DESKTOP_ROOT:-$HOME/.local/opt/kimi-desktop}"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
case "$(uname -m)" in x86_64) ;; *) echo 'KimiDeck currently requires Linux x86-64.' >&2; exit 1;; esac
for tool in node npm tar git make g++ python3 cmp pgrep; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See docs/INSTALL.md for Fedora and Debian prerequisites." >&2; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0])<18)process.exit(1)'
command -v 7zz >/dev/null || command -v 7z >/dev/null || { echo 'Install 7zip first.' >&2; exit 1; }
mkdir -p "$ROOT/updater/shim" "$ROOT/updater/assets" "$ROOT/share" "$BIN" "$DATA/applications"
cp "$SRC"/updater/*.js "$SRC"/updater/*.json "$SRC"/updater/*.sh "$ROOT/updater/"
cp "$SRC"/updater/shim/* "$ROOT/updater/shim/"
cp "$SRC/kimi-desktop.sh" "$SRC/uninstall.sh" "$SRC/VERSION" "$ROOT/"
cp -R "$SRC/share/." "$ROOT/share/"
chmod +x "$ROOT/kimi-desktop.sh" "$ROOT/uninstall.sh" "$ROOT/updater/run-update.sh"
# npm verifies registry integrity; keep the native build outside the source tree.
npm install --prefix "$ROOT/updater/native-build" --ignore-scripts --no-audit --no-fund --save-exact node-pty@1.1.0 node-gyp@11.4.2
node "$ROOT/updater/native-build/node_modules/node-gyp/bin/node-gyp.js" rebuild --directory "$ROOT/updater/native-build/node_modules/node-pty"
PTY="$ROOT/updater/native-build/node_modules/node-pty/build/Release/pty.node"
[ -f "$PTY" ] || { echo 'node-pty build produced no pty.node' >&2; exit 1; }
node -e 'require(process.argv[1])' "$PTY"
cp "$PTY" "$ROOT/updater/assets/pty.node"
if [ -f "$(dirname "$PTY")/spawn-helper" ]; then cp "$(dirname "$PTY")/spawn-helper" "$ROOT/updater/assets/spawn-helper"; fi
KIMI_DESKTOP_ROOT="$ROOT" node "$ROOT/updater/kimi-update.js" --stage "$@"
. "$ROOT/updater/select-runtime.sh"
APP=$(select_runtime)
node "$ROOT/updater/install-icon.js" "$APP/resources/app.asar" "$ROOT/share/kimi-desktop.png"
for alias in kimideck kimi-desktop kimidesktop; do
  target="$BIN/$alias"
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -L "$target" ] && [ "$(readlink "$target")" = "$ROOT/kimi-desktop.sh" ] || { echo "Refusing to replace $target" >&2; exit 1; }
  fi
  ln -sfn "$ROOT/kimi-desktop.sh" "$target"
done
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").replace(/^Exec=@BIN@/gm,()=>"Exec="+JSON.stringify(process.argv[3])).replaceAll("@BIN@",()=>process.argv[3]).replaceAll("Icon=kimi-desktop",()=>"Icon="+process.argv[4]))' "$ROOT/share/kimi-desktop.desktop" "$DATA/applications/com.moonshot.kimichat.desktop" "$BIN/kimideck" "$ROOT/share/kimi-desktop.png"
echo "Installed. Run: $BIN/kimideck"
