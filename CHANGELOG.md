# Changelog

All notable changes to Nodus are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning.

## [Unreleased]

## [0.2.4] - 2026-08-25

### Fixed

- The Linux graphics workaround from 0.2.1–0.2.3 didn't actually take effect: setting the environment variables from inside `main()` and continuing in the same process is too late for at least one of them (`LIBGL_ALWAYS_SOFTWARE`), which Mesa reads while the dynamic linker is still loading the process's shared libraries — before any of our own code runs. The process now re-execs itself once with the environment already correct from the start, the same as if the variables had been exported by the caller. Verified directly: the running process's own `/proc/<pid>/environ` now shows all three variables set purely from this logic, with no manual environment needed.

## [0.2.3] - 2026-08-25

### Fixed

- The white window from 0.2.2, on the same hybrid Intel/NVIDIA (`nouveau`) hardware, is now fixed for real: WebKitGTK was still routing some GL calls through the broken discrete-GPU driver even with compositing disabled. Forcing Mesa's software rasterizer (`LIBGL_ALWAYS_SOFTWARE`) is what actually gets pixels on screen there. A user with a known-good GPU setup can export any of these three variables themselves before launch to opt back into hardware acceleration.

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
