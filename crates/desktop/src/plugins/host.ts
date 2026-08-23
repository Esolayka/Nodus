import { useSettingsStore } from "../store/settingsStore";
import { createPluginContext } from "./context";
import { loadExternalPluginFile } from "./externalLoader";
import type { NodusPlugin } from "./types";

/** Collects everything one enabled plugin registered, so disabling it (or
 * shutting the host down) can undo it all in one call instead of every
 * plugin having to remember its own teardown bookkeeping. */
class DisposableBag {
  private disposers: (() => void)[] = [];

  add(fn: (() => void) | void): void {
    if (fn) this.disposers.push(fn);
  }

  disposeAll(): void {
    for (const fn of this.disposers.splice(0)) fn();
  }
}

/** Runs every built-in tool as a plugin, keeping each one's enabled state in
 * sync with `settings.plugins.enabled` live, and — separately — lets an
 * externally-built plugin be loaded and enabled at runtime, against the
 * exact same `PluginContext` a built-in gets. A single instance for the
 * app's lifetime; `AppShell` calls `start`/`stop` once. */
class PluginHost {
  private readonly ctx = createPluginContext();
  private readonly bags = new Map<string, DisposableBag>();
  private builtins: NodusPlugin[] = [];
  private external: NodusPlugin[] = [];
  private unsubscribeSettings: (() => void) | null = null;

  start(builtins: NodusPlugin[]): void {
    this.builtins = builtins;
    this.sync();
    this.unsubscribeSettings = useSettingsStore.subscribe(() => this.sync());
  }

  stop(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    for (const id of [...this.bags.keys()]) this.disable(id);
  }

  /** Reads, evaluates, and immediately enables a plugin from a separately
   * built file — see `externalLoader.ts`. Not persisted across restarts;
   * loading again next launch is the same one click as the first time. */
  async loadExternal(absolutePath: string): Promise<NodusPlugin> {
    const plugin = await loadExternalPluginFile(absolutePath);
    this.external.push(plugin);
    this.enable(plugin);
    return plugin;
  }

  listExternal(): NodusPlugin[] {
    return this.external;
  }

  private allPlugins(): NodusPlugin[] {
    return [...this.builtins, ...this.external];
  }

  private sync(): void {
    const enabledOverrides = useSettingsStore.getState().settings.plugins.enabled;
    for (const plugin of this.allPlugins()) {
      const shouldBeEnabled = enabledOverrides[plugin.id] ?? plugin.defaultEnabled;
      if (shouldBeEnabled) this.enable(plugin);
      else this.disable(plugin.id);
    }
  }

  private enable(plugin: NodusPlugin): void {
    if (this.bags.has(plugin.id)) return;
    const bag = new DisposableBag();
    bag.add(plugin.onEnable(this.ctx));
    this.bags.set(plugin.id, bag);
  }

  private disable(id: string): void {
    this.bags.get(id)?.disposeAll();
    this.bags.delete(id);
  }
}

export const pluginHost = new PluginHost();
