import { useEffect, useState } from "react";
import type { TaskRow } from "../../types/vault";
import { displayName } from "../../lib/displayName";
import * as api from "../api/client";
import { readTasks } from "../sync";

export function TasksScreen({ onOpen }: { onOpen: (path: string) => void }) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  function load() {
    readTasks()
      .then(setTasks)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(load, []);

  async function toggle(task: TaskRow) {
    const key = `${task.path}:${task.line}`;
    setPending(key);
    try {
      await api.toggleTask(task.path, task.markerStart, task.markerEnd, task.done ? "[x]" : "[ ]", true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  if (error) return <p className="miniapp-empty">{error}</p>;
  if (!tasks) return <p className="miniapp-empty">Loading…</p>;
  if (tasks.length === 0) return <p className="miniapp-empty">No tasks yet.</p>;

  return (
    <div className="tasks-screen">
      {tasks.map((task) => (
        <div key={`${task.path}:${task.line}`} className="task-row">
          <input
            type="checkbox"
            checked={task.done}
            disabled={pending === `${task.path}:${task.line}`}
            onChange={() => void toggle(task)}
          />
          <button type="button" className="task-row-text" onClick={() => onOpen(task.path)}>
            <span>{task.text || "—"}</span>
            <span className="task-row-path">{displayName(task.path)}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
