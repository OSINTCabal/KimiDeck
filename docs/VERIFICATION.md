# Verification

KimiDeck integration release: **1.0.0**. The upstream Kimi application remains version 3.2.20; its version is separate from the Linux integration release.

The baseline integration was imported from the installed Kimi 3.2.20 Linux port. Its three Linux shim files matched the installed ASAR byte for byte before changes.

Regression checks cover destructive prune/rollback behavior, local version path validation, version ordering, and ASAR extraction. Test fixtures use temporary directories.

The source installer successfully rebuilt Kimi 3.2.20 in a separate /tmp installation on Fedora 44, using the downloaded Windows installer and checksum-verified Electron, webbridge, Koffi, uv, and Python dependencies. The native node-pty module was compiled for Linux and loaded successfully. All three launcher aliases and the desktop entry were generated. Initial testing caught Windows prebuild selection; installation now explicitly builds and validates the Linux module.

The corrected suite has 16 tests, including help/invalid uninstall arguments, incomplete runtime selection, damaged-install detection, icon extraction, and native rollback with a live-process guard. All 16 pass in Fedora 44, Debian 12, and Debian 13 when their native Electron runtime is supplied through `KIMI_TEST_ELECTRON`. CI runs 15 portable tests on Node 18, 20, and 22 and skips the native-runtime integration test. Shell and JavaScript syntax checks pass.

## Fedora and Debian checks

Clean Fedora 44 and Debian 12 containers were tested with new unprivileged users. Both installed the documented dependencies, passed all nine regression tests, compiled their own Linux native module, rebuilt Kimi 3.2.20, and generated the launcher aliases and desktop entry. Electron 43.7.3 loaded successfully on both. Each packaged node-pty module ran a shell command and returned the expected output. Debian's official update check reported the installed version as current.

Both applications reached the sign-in window on virtual X11 displays. Fedora's first launch exposed a missing `cmp` prerequisite; `diffutils` is now documented and checked before installation, alongside `pgrep`/procps. CI runs the regression suite on Node 18 and 22, matching the two tested distro Node versions.

The headless GUI checks used `--no-sandbox` inside disposable containers only. This flag is not added to the installed launcher. These checks do not verify desktop sandbox integration or a full Wayland session.

A separate clean Debian 13 environment completed the corrected installer using the documented packages and a new unprivileged account. Its bundled Electron runtime, native PTY shell command, desktop icon, and all 16 tests passed. A graphical sign-in check was not repeated on Debian 13.

## Media

The dashboard screenshot comes from an existing signed-in Kimi capture, with its account footer cropped off. The overview video begins with that still capture, then shows a real sign-in screen recording from the clean Debian install. It contains no audio or entered credentials. The Fedora and Debian sign-in screenshots were captured from their respective isolated installations.

The corrected installer was rerun on both saved distro environments. The upstream application icon was extracted and its absolute path written into the desktop entry. Native-runtime rollback was tested in disposable fixtures: it refused while another process used the app executable and succeeded after that process exited. These checks do not certify rollback across an upstream profile-schema migration.

Damaged-install recovery was exercised by removing the application archive in the disposable Debian 12 install and rerunning installation. The archive was rebuilt successfully. A separate fresh installation root on Fedora 44 was also tested using verified cached downloads.

Remaining acceptance checks: completing live sign-in, login persistence, signed-in chat/coding, overlays after authentication, resize behavior under a real window manager, update activation, and updater-lock contention. The original user's silent launch has not yet been reproduced or diagnosed. A stale profile lock was observed, which alone does not prove the cause. Do not treat this baseline as a fully verified desktop release.

The working installed application was not modified. No upstream application bundle or user profile belongs in Git.
