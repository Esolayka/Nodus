import { useEffect, useMemo, useState } from "react";
import { ChevronsUp, ChevronUp, ChevronDown, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/vault";
import { displayName } from "../../lib/displayName";
import {
  allFoldersIn,
  allTagsIn,
  filterTasks,
  groupByPath,
  sortTasks,
  type TaskSort,
  type TaskStatusFilter,
} from "../../lib/taskFilters";
import { useSettingsStore } from "../../store/settingsStore";
import { useVaultStore } from "../../store/vaultStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { TaskRow } from "../../types/vault";
import { Select } from "../ui/Select";
import "./TasksPanel.css";

const STATUS_OPTIONS: TaskStatusFilter[] = ["all", "today", "overdue", "week", "completed"];

function PriorityIcon({ priority }: { priority: TaskRow["priority"] }) {
  if (priority === 3) return <ChevronsUp size={14} className="task-priority-icon task-priority-high" />;
  if (priority === 2) return <ChevronUp size={14} className="task-priority-icon task-priority-medium" />;
  if (priority === 1) return <ChevronDown size={14} className="task-priority-icon task-priority-low" />;
  return null;
}

function TaskRowView({ task }: { task: TaskRow }) {
  const jumpToLine = useWorkspaceStore((s) => s.jumpToLine);
  const autoCompletionDate = useSettingsStore((s) => s.settings.tasks.autoCompletionDate);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    try {
      await api.toggleTask(
        task.path,
        task.markerStart,
        task.markerEnd,
        task.done ? "[x]" : "[ ]",
        autoCompletionDate,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <li className={`task-row${task.done ? " task-row-done" : ""}`}>
      <input type="checkbox" checked={task.done} disabled={pending} onChange={() => void toggle()} />
      <button type="button" className="task-row-text" onClick={() => void jumpToLine(task.path, task.line)}>
        {task.text || <em>—</em>}
      </button>
      {task.priority != null && (
        <span className="task-badge task-badge-priority">
          <PriorityIcon priority={task.priority} />
        </span>
      )}
      {task.due && (
        <span className="task-badge task-badge-due">
          <CalendarDays size={12} /> {task.due}
        </span>
      )}
    </li>
  );
}

export function TasksPanel() {
  const { t } = useTranslation();
  const changeVersion = useVaultStore((s) => s.changeVersion);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [status, setStatus] = useState<TaskStatusFilter>("all");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [sort, setSort] = useState<TaskSort>("date");

  useEffect(() => {
    api.getAllTasks().then(setTasks);
  }, [changeVersion]);

  const filtered = useMemo(() => filterTasks(tasks, status, tag, folder), [tasks, status, tag, folder]);
  const sorted = useMemo(() => sortTasks(filtered, sort), [filtered, sort]);
  const groups = useMemo(() => groupByPath(sorted), [sorted]);
  const tagOptions = useMemo(
    () => [{ value: "", label: t("tasks.allTags") }, ...allTagsIn(tasks).map((v) => ({ value: v, label: `#${v}` }))],
    [tasks, t],
  );
  const folderOptions = useMemo(
    () => [{ value: "", label: t("tasks.allFolders") }, ...allFoldersIn(tasks).map((v) => ({ value: v, label: v }))],
    [tasks, t],
  );

  return (
    <div className="tasks-panel">
      <div className="tasks-panel-toolbar">
        <div className="tasks-status-toggle">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={status === option ? "active" : ""}
              onClick={() => setStatus(option)}
            >
              {t(`tasks.status_${option}`)}
            </button>
          ))}
        </div>
        <div className="tasks-filters-row">
          <Select ariaLabel={t("tasks.allTags")} value={tag} options={tagOptions} onChange={setTag} />
          <Select ariaLabel={t("tasks.allFolders")} value={folder} options={folderOptions} onChange={setFolder} />
        </div>
        <div className="tasks-sort-toggle">
          <button type="button" className={sort === "date" ? "active" : ""} onClick={() => setSort("date")}>
            {t("tasks.sortDate")}
          </button>
          <button type="button" className={sort === "priority" ? "active" : ""} onClick={() => setSort("priority")}>
            {t("tasks.sortPriority")}
          </button>
        </div>
      </div>
      {groups.size === 0 ? (
        <p className="side-panel-empty">{t("tasks.empty")}</p>
      ) : (
        <div className="tasks-groups">
          {[...groups.entries()].map(([path, group]) => (
            <div key={path} className="tasks-group">
              <div className="tasks-group-title">{displayName(path)}</div>
              <ul className="tasks-list">
                {group.map((task) => (
                  <TaskRowView key={`${task.path}:${task.line}`} task={task} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
