# Nodus

<img src="crates/desktop/public/nodus-logo.png" alt="Nodus" width="96" />

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

Nodus is a free and open source desktop workspace for linked Markdown notes. It is built with Tauri 2, React and Rust and runs on Linux, Windows and macOS.

Notes remain ordinary `.md` files in a folder chosen by the user. Nodus does not require a proprietary file format or a cloud account.

## Current status

Nodus 0.1 is a pre-release. The main desktop workflows are implemented, but file formats and experimental integrations can still change.

Available now:

- Markdown editing with live preview and frontmatter
- tabs, file tree, quick switcher, command palette and hotkeys
- wikilinks, backlinks, outgoing links and unlinked mentions
- full-text search, tags, tasks, bookmarks and daily notes
- interactive graph and visual canvas
- images, attachments, PDF, audio and video embeds
- note history, templates and Obsidian or Notion import
- Git sync and experimental Nodus server sync
- experimental local Telegram bot and Mini App
- light, dark and custom themes in Russian and English

Server sync currently transfers plaintext content. Treat it as experimental and use only a server you trust. End-to-end encryption is not connected to server sync yet.

## Repository structure

```text
crates/
|-- ai/                 AI indexing and vector storage
|-- core/               Vault, index, history, search, sync and import logic
|-- crypto/             Cryptographic primitives
|-- desktop/            Tauri 2 and React desktop application
|-- sync-server/        Self-hosted synchronization server
`-- telegram/           Telegram validation helpers
```

Architecture notes are stored in [`docs/architecture.md`](docs/architecture.md).

## Development

Required tools:

- Rust stable, pinned by [`rust-toolchain.toml`](rust-toolchain.toml)
- Node.js 20 or newer and npm
- the platform dependencies listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```sh
cd crates/desktop
npm ci
npm run tauri dev
```

## Verification

Run the same checks used by CI before opening a pull request:

```sh
python3 scripts/check-control-chars.py
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd crates/desktop
npm ci
npm test
npm run build
```

On modern Linux distributions, build the AppImage with stripping disabled because the `linuxdeploy` binary bundled by Tauri cannot read newer `.relr.dyn` sections:

```sh
cd crates/desktop
npm run build:appimage
```

CI builds `.deb`, `.rpm`, AppImage, `.app`, `.dmg` and NSIS artifacts. Pushing a `v*` tag creates a draft GitHub Release and attaches the packages after every platform succeeds.

## Release notes and security

Changes are tracked in [`CHANGELOG.md`](CHANGELOG.md). Please follow [`SECURITY.md`](SECURITY.md) when reporting security problems.

## License

Nodus is distributed under AGPL-3.0-or-later. See [`LICENSE`](LICENSE).
