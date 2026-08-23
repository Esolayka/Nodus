import { formatDate } from "./dateFormat";

export interface TemplateContext {
  /** The name of the note being created/inserted into, no `.md` extension. */
  title: string;
  /** Whatever text was selected in the editor at insertion time. */
  selection: string;
}

const VARIABLE_RE = /\{\{\s*([a-zA-Z]+)(?::([^}]*))?\s*\}\}/g;

/** Scans a template for `{{input:Question}}` prompts and returns the
 * question text for each occurrence, in document order — one dialog field
 * per occurrence (not deduplicated by question text), per spec: several
 * marks make for several fields in one dialog. */
export function collectInputPrompts(template: string): string[] {
  const prompts: string[] = [];
  for (const match of template.matchAll(VARIABLE_RE)) {
    const [, name, arg] = match;
    if (name.toLowerCase() === "input") prompts.push((arg ?? "").trim());
  }
  return prompts;
}

/** Expands every recognized `{{...}}` variable in `template`. `{{cursor}}`
 * is deliberately left untouched — the editor's insertion step turns it
 * into a tab-stop. Any other unrecognized `{{...}}` is left untouched too,
 * rather than erroring, since it may be intentional literal text. */
export function expandTemplate(
  template: string,
  context: TemplateContext,
  inputAnswers: string[],
): string {
  const now = new Date();
  let inputIndex = 0;

  return template.replace(VARIABLE_RE, (whole, rawName: string, rawArg?: string) => {
    const name = rawName.toLowerCase();
    switch (name) {
      case "date":
        return formatDate(now, rawArg?.trim() || "YYYY-MM-DD");
      case "time":
        return formatDate(now, rawArg?.trim() || "HH:mm");
      case "title":
        return context.title;
      case "selection":
        return context.selection;
      case "input": {
        const answer = inputAnswers[inputIndex] ?? "";
        inputIndex += 1;
        return answer;
      }
      case "cursor":
        return whole;
      default:
        return whole;
    }
  });
}
