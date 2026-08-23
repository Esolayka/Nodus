import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function gitInfo() {
  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    const dirty = execSync("git status --porcelain").toString().trim().length > 0;
    return hash + (dirty ? "+" : "");
  } catch {
    return "unknown";
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify(gitInfo()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  // Second page alongside the main `index.html` — the Telegram Mini App,
  // served over HTTP by the Rust local-mode server (crates/core's
  // local_server) rather than loaded into the Tauri window itself. Vite's
  // multi-page build just adds `dist/miniapp.html` + its own chunks next
  // to the main app's output; it doesn't change how `frontendDist` finds
  // `dist/index.html` for Tauri's own window.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        miniapp: fileURLToPath(new URL("./miniapp.html", import.meta.url)),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
