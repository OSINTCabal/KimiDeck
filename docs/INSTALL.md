# Install KimiDeck

Fedora and Debian use the same installer. Linux x86-64, Node 18 or newer, internet access, and several gigabytes of temporary disk space are required.

## System packages

**Fedora 44**

```bash
sudo dnf install nodejs npm git tar make gcc-c++ python3 7zip diffutils procps-ng gtk3 nss alsa-lib libXScrnSaver libXtst libxkbcommon mesa-libgbm
```

**Debian 12**

```bash
sudo apt update
sudo apt install nodejs npm git tar build-essential python3 7zip ca-certificates diffutils procps libgtk-3-0 libnss3 libasound2 libxss1 libxtst6 libxkbcommon0 libgbm1
```

**Debian 13**

```bash
sudo apt update
sudo apt install nodejs npm git tar build-essential python3 7zip ca-certificates diffutils procps libgtk-3-0t64 libnss3 libasound2t64 libxss1 libxtst6 libxkbcommon0 libgbm1
```

Installation and native-runtime checks passed on Fedora 44, Debian 12, and Debian 13. See [verification results](VERIFICATION.md) for the scope and remaining desktop checks.

## Install and launch

For a private repository, authenticate GitHub through SSH or your Git credential helper before cloning.

```bash
git clone https://github.com/OSINTCabal/KimiDeck.git
cd KimiDeck
bash install.sh
~/.local/bin/kimideck
```

The installer adds the app and its icon to your application menu. If `~/.local/bin` is on your `PATH`, you can also run `kimideck`. Otherwise use the full command above or add that directory to your shell's `PATH`.

Installation uses `~/.local/opt/kimi-desktop` and preserves the existing Kimi profile under the XDG config directory. Close Kimi before reinstalling. A reinstall rebuilds a damaged application; the previous working build is kept during successful upstream upgrades.

To use a locally downloaded installer:

```bash
bash install.sh --from-file /path/to/kimi_3.2.20.exe --version 3.2.20
```

Local installers are supplied by you and do not receive independent feed verification. Downloads from the official feed are checked against its checksum metadata.

Windows-only tools require Wine separately. Installation does not enable the included systemd timer automatically. Use in-app updates or the terminal commands in the [README](../README.md). `uninstall.sh --help` prints available removal options without changing the installation.
