#!/bin/sh
# Runs the Kimi updater with the newest installed Electron in node mode (no system node needed).
ROOT="${KIMI_DESKTOP_ROOT:-$(dirname "$(dirname "$(readlink -f "$0")")")}"
export KIMI_DESKTOP_ROOT="$ROOT"
. "$ROOT/updater/select-runtime.sh"
DIR=$(select_runtime) || { echo 'no complete Kimi runtime found' >&2; exit 1; }
EXE="$DIR/kimi-desktop"
[ -x "$EXE" ] || { echo "no Kimi runtime found" >&2; exit 1; }
ELECTRON_RUN_AS_NODE=1 exec "$EXE" "$ROOT/updater/kimi-update.js" "$@"
