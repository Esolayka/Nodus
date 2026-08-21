export interface OutlineHeading {
  level: number;
  text: string;
  /** Byte/char offset of the line start, for jump-to-heading. */
  position: number;
}

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Plain-text ATX heading scan (`# Heading` .. `###### Heading`), mirroring
 * what the live-preview already recognizes. Recomputed from the buffer's raw
 * text rather than the editor's syntax tree, so it stays in sync even when
 * no `NoteEditor` for the note happens to be mounted. */
export function extractOutline(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let position = 0;
  for (const line of content.split("\n")) {
    const match = ATX_HEADING.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], position });
    }
    position += line.length + 1;
  }
  return headings;
}
