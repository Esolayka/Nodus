import { useEffect, useState } from "react";
import { Circle, CircleCheck } from "lucide-react";
import type { TaskRow } from "../../types/vault";
import { displayName } from "../../lib/displayName";
import * as api from "../api/client";
import { readTasks } from "../sync";
import { haptic, hapticSuccess } from "../telegram";

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
      if (task.done) haptic();
      else hapticSuccess();
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
    <div className="tasks-screen miniapp-card">
      {tasks.map((task) => {
        const key = `${task.path}:${task.line}`;
        return (
          <div key={key} className={`task-row${task.done ? " task-row-done" : ""}`}>
            <button
              type="button"
              role="checkbox"
              aria-checked={task.done}
              className={`task-check${task.done ? " task-check-done" : ""}`}
              disabled={pending === key}
              onClick={() => void toggle(task)}
            >
              {task.done ? <CircleCheck size={22} /> : <Circle size={22} />}
            </button>
            <button type="button" className="task-row-text" onClick={() => (haptic(), onOpen(task.path))}>
              <span>{task.text || "—"}</span>
              <span className="task-row-path">{displayName(task.path)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
