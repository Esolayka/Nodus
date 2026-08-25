# Changelog

All notable changes to Nodus are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning.

## [Unreleased]

## [0.2.2] - 2026-08-25

### Fixed

- Linux builds on the same hybrid Intel/NVIDIA (`nouveau`) hardware fixed in 0.2.1 could still show a blank white window instead of aborting — WebKitGTK's accelerated compositor needed to be disabled too, not just its DMA-BUF renderer.

## [0.2.1] - 2026-08-25

### Fixed

- Linux builds could fail to start at all on hybrid Intel/NVIDIA laptops using the open-source `nouveau` driver under Wayland, aborting with "Could not create surfaceless EGL display: EGL_BAD_ALLOC" before any window appeared.

## [0.2.0] - 2026-08-25

### Added

- Telegram bot: forwards messages to the vault's daily note, long-polling with offline-safe offset tracking, `/start <code>` deep-link handshake to the Mini App.
- Telegram Mini App: full redesign in Telegram's own grouped-list style, note creation, a Settings screen (Appearance override + Language switch), and haptic feedback on interactive elements.
- `cloudflared` auto-download for one-tap tunnel setup when it isn't already installed.
- `docs/plugins.md` and `docs/themes.md`: practical guides for building a plugin or customizing a theme.

### Fixed

- Writing a note into a folder that doesn't exist yet (e.g. the Mini App's daily-note append, on first use) no longer fails with "No such file or directory".
- Textareas now use the app's theme colors instead of the browser's default (previously unreadable dark-on-dark/black-on-black in the Mini App).
- Telegram linking failed for every user with "no vault is open to link" — the vault's linking identity was never actually loaded into the local server.
- Removed a duplicate "Settings" entry from the left ribbon (already reachable from the sidebar footer, next to Help).

## [0.1.1] - 2026-08-24

### Fixed

- macOS bundles now use an ad-hoc signature so Apple Silicon can validate and launch the application bundle.

## [0.1.0] - 2026-08-24

### Fixed

- Linux shells can match the running Nodus window to its desktop launcher and icon.

### Added

- Desktop notes workspace with tabs, Markdown editing, graph and canvas.
- Search, tags, tasks, bookmarks, daily notes and templates.
- Git and server synchronization options.
- Telegram Mini App integration.
- Obsidian and Notion import tools.
