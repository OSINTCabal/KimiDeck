# Development

The repository contains the Linux integration source. Kimi's application bundle and downloaded runtimes are prepared during installation and stay outside Git.

`VERSION` identifies the KimiDeck integration release. Version 1.0.0 starts with a single initial commit. The upstream Kimi and Electron version numbers remain separate.

- `updater/` handles verified downloads, extraction, runtime preparation, and version management.
- `updater/shim/` contains the Linux entry point, updater bridge, and UI fixes.
- `share/` contains desktop and systemd templates.
- `tests/` exercises updater safety and uninstall behavior in disposable directories.

Run the tests with Node 18 or newer:

```bash
node --test tests/*.test.cjs
for f in install.sh kimi-desktop.sh uninstall.sh updater/*.sh; do sh -n "$f" || exit; done
for f in updater/*.js updater/shim/*.cjs updater/shim/*.mjs; do node --check "$f" || exit; done
```

For an isolated install, set `KIMI_DESKTOP_ROOT`, `XDG_BIN_HOME`, and `XDG_DATA_HOME` to disposable directories before running the installer. This separates installed files and launchers; it does not isolate the application's account profile. Use a separate desktop test account for graphical acceptance tests.

Never add application bundles, native binaries, credentials, profiles, or logs to Git. Test profile retention and rollback before installing updater changes over a working app.
