/** The app-wide command registry — the command palette (Ctrl+P) lists
 * whatever is registered here, and this is deliberately the *same* registry
 * a future plugin API would use to add its own commands: no separate
 * "built-in vs. plugin" command list, no special privilege either side
 * needs. Framework-agnostic on purpose (plain Map + subscribe callbacks,
 * not a Zustand store) so it isn't coupled to how the palette happens to be
 * implemented today. */

export interface Command {
  /** Stable, never-reused identifier, e.g. `"app.newNote"`. */
  id: string;
  /** Display name — already translated by whoever registers it. */
  title: string;
  /** Human-readable hotkey label for display only (e.g. `"Ctrl+N"`); the
   * actual key binding lives in the hotkey registry, keyed by this same id. */
  hotkeyLabel?: string;
  run: () => void | Promise<void>;
}

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Registers a command, replacing any existing one with the same id.
 * Returns an unregister function — call it on cleanup (e.g. a plugin being
 * disabled) so the palette doesn't keep offering a dead command. */
export function registerCommand(command: Command): () => void {
  commands.set(command.id, command);
  notify();
  return () => {
    if (commands.get(command.id) === command) {
      commands.delete(command.id);
      notify();
    }
  };
}

export function unregisterCommand(id: string): void {
  if (commands.delete(id)) notify();
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

export function listCommands(): Command[] {
  return [...commands.values()];
}

export function runCommand(id: string): void {
  const command = commands.get(id);
  if (command) void command.run();
}

/** For `useSyncExternalStore` — a stable snapshot reference that only
 * changes identity when the command set actually changes. */
let snapshot: Command[] = [];
let snapshotStale = true;
listeners.add(() => {
  snapshotStale = true;
});

export function getCommandsSnapshot(): Command[] {
  if (snapshotStale) {
    snapshot = listCommands();
    snapshotStale = false;
  }
  return snapshot;
}

export function subscribeCommands(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
