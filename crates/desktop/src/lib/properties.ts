export interface PropertyEntry {
  key: string;
  /** This simple parser doesn't try to distinguish number/boolean/date from
   * plain text — same "good enough to display and lightly edit the common
   * shapes" bar the read-only version of this panel already held itself
   * to. Only a scalar `key: value` vs. a `key:\n  - item` block list. */
  type: "text" | "list";
  value: string | string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function findFrontmatterBlock(text: string): { yaml: string; blockLength: number } | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;
  return { yaml: match[1], blockLength: match[0].length };
}

export function parseProperties(yaml: string): PropertyEntry[] {
  const entries: PropertyEntry[] = [];
  for (const line of yaml.split("\n")) {
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    const last = entries[entries.length - 1];
    if (listItem && last && last.type === "list") {
      (last.value as string[]).push(listItem[1].trim());
      continue;
    }
    const kv = /^(\S[^:]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const rest = kv[2].trim();
    entries.push(rest === "" ? { key, type: "list", value: [] } : { key, type: "text", value: rest });
  }
  // A "key:" line that never got any "- item" lines under it was just a
  // blank scalar, not really a list.
  for (const entry of entries) {
    if (entry.type === "list" && (entry.value as string[]).length === 0) {
      entry.type = "text";
      entry.value = "";
    }
  }
  return entries;
}

export function serializeProperties(entries: PropertyEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry.key.trim()) continue;
    if (entry.type === "list") {
      lines.push(`${entry.key}:`);
      for (const item of entry.value as string[]) lines.push(`  - ${item}`);
    } else {
      lines.push(`${entry.key}: ${entry.value}`);
    }
  }
  return lines.join("\n");
}

/** Replaces (or, if none existed yet, inserts) `text`'s frontmatter block
 * with `entries` serialized back to YAML. Leaves everything after the block
 * untouched. */
export function applyProperties(text: string, entries: PropertyEntry[]): string {
  const yaml = serializeProperties(entries);
  const existing = findFrontmatterBlock(text);
  if (existing) {
    return `---\n${yaml}\n---\n${text.slice(existing.blockLength)}`;
  }
  if (entries.length === 0) return text;
  return `---\n${yaml}\n---\n${text}`;
}
