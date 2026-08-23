/** One generic registry shape, reused for every new plugin extension
 * point (sidebar views, right-panel tabs, ...) instead of hand-rolling
 * the same Map+listeners+snapshot dance each time — `commandRegistry.ts`
 * already proved this shape works for `useSyncExternalStore` consumers
 * like the command palette; this is that same shape, generalized. */

export interface RegistryEntry {
  id: string;
  /** Lower sorts first. Core/built-in entries use multiples of 10,
   * leaving room for plugins to slot in between without renumbering
   * anything. */
  order: number;
}

export interface Registry<T extends RegistryEntry> {
  /** Registers `entry`, replacing any existing one with the same id.
   * Returns an unregister function — call it when a plugin disables. */
  register(entry: T): () => void;
  get(id: string): T | undefined;
  /** Sorted by `order`, ties broken by registration order. */
  list(): T[];
  getSnapshot(): T[];
  subscribe(onChange: () => void): () => void;
}

export function createRegistry<T extends RegistryEntry>(): Registry<T> {
  const entries = new Map<string, T>();
  const listeners = new Set<() => void>();
  let snapshot: T[] = [];
  let stale = true;

  function notify() {
    stale = true;
    for (const listener of listeners) listener();
  }

  function list(): T[] {
    return [...entries.values()].sort((a, b) => a.order - b.order);
  }

  return {
    register(entry) {
      entries.set(entry.id, entry);
      notify();
      return () => {
        if (entries.get(entry.id) === entry) {
          entries.delete(entry.id);
          notify();
        }
      };
    },
    get: (id) => entries.get(id),
    list,
    getSnapshot() {
      if (stale) {
        snapshot = list();
        stale = false;
      }
      return snapshot;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
