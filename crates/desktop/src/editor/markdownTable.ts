export type ColumnAlign = "left" | "center" | "right" | null;

export interface ParsedTable {
  header: string[];
  aligns: ColumnAlign[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseAlign(cell: string): ColumnAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** Minimal GFM table parser: header row, `---|:--:` delimiter row (used only
 * for alignment), then data rows. Assumes well-formed input — the grammar
 * already validated it's a `Table` node before this ever runs. */
export function parseMarkdownTable(text: string): ParsedTable {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0] ? splitRow(lines[0]) : [];
  const aligns = lines[1] ? splitRow(lines[1]).map(parseAlign) : header.map(() => null);
  const rows = lines.slice(2).map(splitRow);
  return { header, aligns, rows };
}
