# random-note-external

A real, standalone Nodus plugin — built and packaged completely outside the
Nodus source tree, with no dependency on it beyond the plugin contract typed
in `src/types.ts` (copied by hand, not imported from the app). It exists to
answer one question: is `PluginContext` a real external API, or just an
internal convenience wrapper the built-in tools happen to use?

It re-implements the built-in "Random note" tool — pick a random note from
the vault and open it — using nothing but `ctx.vault.listNotes()` and
`ctx.workspace.openNote()`.

## Build

```sh
npm install
npm run build
```

Produces `dist/index.cjs`, a single CommonJS file with no runtime
dependencies. Nodus loads it via Settings → Plugins → "Load external
plugin…", which reads this file's text and evaluates it directly (the same
way Obsidian loads a community plugin's `main.js`) — no rebuild of the app,
no code shared at the source level.
