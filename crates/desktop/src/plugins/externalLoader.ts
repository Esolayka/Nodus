import { invoke } from "@tauri-apps/api/core";
import type { NodusPlugin } from "./types";

/** Loads a plugin from a separately-built `.cjs` file the user picked —
 * proof that `PluginContext` is a real external API, not just an internal
 * convenience wrapper. The bundle is expected to be plain CommonJS
 * (`module.exports = {...}` or `module.exports.default = {...}`), built by
 * the plugin's own toolchain against nothing but the `NodusPlugin`/
 * `PluginContext` shapes — no access to this app's source, stores, or
 * build. Evaluated the same way Obsidian loads a community plugin's
 * `main.js`: read as text, run through the `Function` constructor with a
 * minimal `require` shim, since there's no bundler/module-federation setup
 * here to do it more elaborately. */
export async function loadExternalPluginFile(absolutePath: string): Promise<NodusPlugin> {
  const code = await invoke<string>("read_external_file_text", { path: absolutePath });

  const moduleObj: { exports: unknown } = { exports: {} };
  const require = (name: string): never => {
    throw new Error(`External plugin "${absolutePath}" required unknown module "${name}"`);
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function("module", "exports", "require", code);
    run(moduleObj, moduleObj.exports, require);
  } catch (error) {
    throw new Error(`Failed to evaluate external plugin "${absolutePath}": ${String(error)}`);
  }

  const exported = moduleObj.exports as { default?: unknown } | NodusPlugin;
  const candidate = (exported as { default?: unknown }).default ?? exported;

  if (!isNodusPlugin(candidate)) {
    throw new Error(`"${absolutePath}" does not export a valid Nodus plugin`);
  }
  return candidate;
}

function isNodusPlugin(value: unknown): value is NodusPlugin {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<NodusPlugin>;
  return (
    typeof p.id === "string" &&
    typeof p.nameKey === "string" &&
    typeof p.descriptionKey === "string" &&
    (p.tier === "isolated" || p.tier === "full") &&
    typeof p.defaultEnabled === "boolean" &&
    typeof p.onEnable === "function"
  );
}
