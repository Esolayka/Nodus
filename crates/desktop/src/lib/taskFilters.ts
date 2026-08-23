import type { TaskRow } from "../types/vault";

export type TaskStatusFilter = "all" | "today" | "overdue" | "week" | "completed";
export type TaskSort = "date" | "priority";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function endOfWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TAG_RE = /#([\w/-]+)/g;

export function tagsInText(text: string): string[] {
  return [...text.matchAll(TAG_RE)].map((m) => m[1]);
}

export function allTagsIn(tasks: TaskRow[]): string[] {
  const set = new Set<string>();
  for (const task of tasks) for (const tag of tagsInText(task.text)) set.add(tag);
  return [...set].sort();
}

export function allFoldersIn(tasks: TaskRow[]): string[] {
  const set = new Set<string>();
  for (const task of tasks) {
    const idx = task.path.lastIndexOf("/");
    if (idx > 0) set.add(task.path.slice(0, idx));
  }
  return [...set].sort();
}

export function filterTasks(
  tasks: TaskRow[],
  status: TaskStatusFilter,
  tag: string,
  folder: string,
): TaskRow[] {
  const today = todayIso();
  const weekEnd = endOfWeekIso();
  return tasks.filter((task) => {
    if (status !== "completed" && task.done) return false;
    if (status === "completed" && !task.done) return false;
    if (status === "today" && task.due !== today) return false;
    if (status === "overdue" && !(task.due != null && task.due < today)) return false;
    if (status === "week" && !(task.due != null && task.due >= today && task.due <= weekEnd)) return false;
    if (tag && !tagsInText(task.text).includes(tag)) return false;
    if (folder && !(task.path === folder || task.path.startsWith(`${folder}/`))) return false;
    return true;
  });
}

export function sortTasks(tasks: TaskRow[], sort: TaskSort): TaskRow[] {
  const copy = [...tasks];
  if (sort === "date") {
    copy.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  } else {
    copy.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
  return copy;
}

export function groupByPath(tasks: TaskRow[]): Map<string, TaskRow[]> {
  const groups = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const list = groups.get(task.path) ?? [];
    list.push(task);
    groups.set(task.path, list);
  }
  return groups;
}
