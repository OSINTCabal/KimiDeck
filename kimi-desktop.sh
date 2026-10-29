#!/bin/sh
# Kimi desktop (Linux) launcher: runs the highest complete app-<ver>/ under ~/.local/opt/kimi-desktop
#   kimi-desktop [--check-updates] [args]   | kimi-desktop --update [--check|--stage|--rollback]
ROOT="${KIMI_DESKTOP_ROOT:-$(dirname "$(readlink -f "$0")")}"
export KIMI_DESKTOP_ROOT="$ROOT" KIMI_DESKTOP_LAUNCHER="$(readlink -f "$0")"
if [ "${1:-}" = "--update" ]; then shift; exec "$ROOT/updater/run-update.sh" "$@"; fi
. "$ROOT/updater/select-runtime.sh"
APP=$(select_runtime) || { echo "kimi-desktop: no complete installed version in $ROOT" >&2; exit 1; }
# Windows-only console tools (kimi-slides, kimiim-cli) run via Wine from a stable path the app's wrappers point to
mkdir -p "$ROOT/wine-tools"
for s in "$APP"/resources/resources/wine/*.exe; do [ -f "$s" ] && ! cmp -s "$s" "$ROOT/wine-tools/${s##*/}" && cp -f "$s" "$ROOT/wine-tools/${s##*/}"; done
# superseded app-<ver>/ dirs are removed once nothing runs from them (a rollback-<ver> copy is kept)
( sleep 60; "$ROOT/updater/run-update.sh" --prune ) >/dev/null 2>&1 &
export CHROME_DESKTOP=com.moonshot.kimichat.desktop
FLAGS="--enable-features=WebRTCPipeWireCapturer,GlobalShortcutsPortal,WaylandWindowDecorations"
if [ -n "${KIMI_FORCE_X11:-}" ]; then FLAGS="$FLAGS --ozone-platform=x11"; else FLAGS="$FLAGS --ozone-platform-hint=auto"; [ -n "${WAYLAND_DISPLAY:-}" ] && FLAGS="$FLAGS --enable-wayland-ime"; fi
exec "$APP/kimi-desktop" $FLAGS "$@"
