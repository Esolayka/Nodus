# Changelog

All notable changes to Nodus are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning.

## [Unreleased]

## [0.2.7] - 2026-08-26

### Added

- Themes can now be loaded from a `.css` file without rebuilding the app: `Settings → Appearance → Load external theme…`, next to "Create theme". It reads the file the same way external plugins do, pulls out whatever `--custom-property: value;` declarations it finds (regardless of selector), and fills in a full theme — colors the file doesn't define fall back to the currently active theme's, and the light/dark base is inferred from the background's lightness rather than needing to be specified. The result becomes a normal, fully persistent custom theme, editable afterward in the same color editor as any other. See `docs/themes.md` for the exact variable names.

## [0.2.6] - 2026-08-26

### Fixed

- The Graph view never rendered anything, on every platform (not just Linux) and regardless of GPU: PixiJS's default renderer uses `new Function` internally to compile fast paths for shader/uniform syncing, which the app's Content-Security-Policy has always correctly blocked (`'unsafe-eval'` is intentionally absent). `Application.init()` was rejecting outright with "Current environment does not allow unsafe-eval", silently leaving the canvas empty. Now imports PixiJS's own eval-free polyfill module before any other use of the library, so the CSP stays exactly as strict as before.
- On Linux, the Graph view also now skips WebGL entirely in favor of the Canvas 2D renderer specifically when the app has forced `WEBKIT_DISABLE_COMPOSITING_MODE` (see 0.2.1–0.2.5): that variable turns off the same accelerated-compositing pipeline WebGL canvases render through in WebKitGTK, so a WebGL context there can succeed while never actually reaching the page. Canvas 2D paints through a separate, unaffected path.
- The window's maximize/minimize titlebar buttons did nothing on Linux: the AppImage's own launcher unconditionally forces `GDK_BACKEND=x11` for a real but narrowly-scoped reason (a GNOME-specific `gsettings` schema crash, [tauri-apps/tauri#8541](https://github.com/tauri-apps/tauri/issues/8541)), and niri's XWayland compatibility layer (used by any non-GNOME Wayland compositor's X11 clients, confirmed here via its `_NET_SUPPORTED` list) doesn't implement the maximize/minimize window states at all — only fullscreen. X11 is now only forced when actually running under GNOME; everywhere else gets native Wayland, where niri's own window management handles both correctly.

## [0.2.5] - 2026-08-26

### Fixed

- The white window persisted in 0.2.4 even with the re-exec fix confirmed active: the AppImage bundles its own copy of WebKitGTK/GTK (whatever was current on the CI runner at build time), and on the same affected hybrid Intel/NVIDIA (`nouveau`) hardware, that specific bundled build still renders a blank window — while the exact same frontend against the host's own system WebKitGTK package renders correctly. Also, the AppImage's own launcher sets `LD_LIBRARY_PATH` itself right before starting the app, unconditionally prepending its bundle's lib dir, so setting it any earlier in that chain was always getting overridden regardless. Now, when a system WebKitGTK is present on the host, the app prefers it over the bundled copy (library path and GTK module/loader paths alike), falling back to the bundle unchanged when the system doesn't have one, so the AppImage stays portable for systems without it installed. Verified against the actual CI-built bundle's own (older) WebKitGTK on the affected hardware, not just a local rebuild.
- Also forces `GDK_BACKEND=x11`, working around a separate known WebKitGTK crash on the native Wayland backend ([tauri-apps/tauri#8541](https://github.com/tauri-apps/tauri/issues/8541)) — the AppImage's launcher already did this for the AppImage build specifically; it's now applied uniformly across all Linux package formats.

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
