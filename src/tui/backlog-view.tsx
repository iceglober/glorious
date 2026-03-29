import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import {
  loadBacklog,
  saveBacklog,
  addTask,
  deleteTask,
  moveTaskUp,
  moveTaskDown,
  nextPendingTask,
  dependenciesMet,
  type Backlog,
  type Task,
  type TaskStatus,
} from "./backlog.js";
import { pullMain, checkPrStatus } from "./git-sync.js";
import { TaskForm } from "./task-form.js";

function statusIcon(s: TaskStatus): string {
  return { pending: "◦", active: "⚙", shipped: "↑", merged: "✓" }[s];
}

function statusColor(s: TaskStatus): string {
  return { pending: "gray", active: "cyan", shipped: "yellow", merged: "green" }[s];
}

interface BacklogViewProps {
  backlog: Backlog;
  rows: number;
  onStartTask: (task: Task) => void;
  onRefresh: () => void;
  onModalChange: (active: boolean) => void;
  onViewSession: (sessionIndex: number) => void;
  sessions: Array<{ name: string; status: string }>;
}

export function BacklogView({ backlog, rows, onStartTask, onRefresh, onModalChange, onViewSession, sessions }: BacklogViewProps) {
  const [cursor, setCursor] = useState(0);
  const [modeState, setModeState] = useState<"list" | "add" | "edit" | "confirm-delete">("list");
  const setMode = useCallback((m: typeof modeState) => {
    setModeState(m);
    onModalChange(m !== "list");
  }, [onModalChange]);
  const [notification, setNotification] = useState("");

  const notify = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 3_000);
  }, []);

  const tasks = backlog.tasks;

  const mode = modeState;

  useInput((input, key) => {
    if (mode !== "list") return;

    // Navigation
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(tasks.length - 1, c + 1));

    // Start focused task or view its session
    if (key.return && tasks[cursor]) {
      const task = tasks[cursor];
      if (task.status === "pending") {
        if (task.dependencies.length > 0 && !dependenciesMet(backlog, task)) {
          notify(`Blocked by: ${task.dependencies.join(", ")}`);
        } else {
          onStartTask(task);
        }
      } else if (task.status === "active" && task.branch) {
        const idx = sessions.findIndex((s) => s.name === task.branch);
        if (idx >= 0) onViewSession(idx);
      } else {
        notify(`Task is ${task.status}`);
      }
    }

    // View session for focused task
    if (input === "v" && tasks[cursor]?.branch) {
      const idx = sessions.findIndex((s) => s.name === tasks[cursor].branch);
      if (idx >= 0) onViewSession(idx);
    }

    // Kill session for focused task
    if (input === "x" && tasks[cursor]?.status === "active" && tasks[cursor]?.branch) {
      const idx = sessions.findIndex((s) => s.name === tasks[cursor].branch);
      if (idx >= 0) {
        const s = sessions[idx] as any;
        if (s.kill) s.kill();
      }
      tasks[cursor].status = "pending";
      tasks[cursor].branch = null;
      tasks[cursor].startedAt = null;
      saveBacklog(backlog);
      notify(`Killed: ${tasks[cursor].title}`);
      onRefresh();
    }

    // Auto-start next pending task
    if (input === "s" || input === "S") {
      const task = nextPendingTask(backlog);
      if (task) {
        onStartTask(task);
      } else {
        notify("No pending tasks");
      }
    }

    // CRUD
    if (input === "a") setMode("add");
    if (input === "e" && tasks[cursor]) setMode("edit");
    if (input === "d" && tasks[cursor]) setMode("confirm-delete");

    // Reorder (K=up, J=down — vim-style)
    if ((input === "K" || (key.shift && input === "k")) && tasks[cursor]) {
      moveTaskUp(backlog, cursor);
      setCursor((c) => Math.max(0, c - 1));
      onRefresh();
    }
    if ((input === "J" || (key.shift && input === "j")) && tasks[cursor]) {
      moveTaskDown(backlog, cursor);
      setCursor((c) => Math.min(tasks.length - 1, c + 1));
      onRefresh();
    }

    // Refresh (pull main + check PRs)
    if (input === "r") {
      const ok = pullMain();
      let merged = 0;
      for (const task of backlog.tasks) {
        if (task.status === "shipped" && task.pr) {
          const prStatus = checkPrStatus(task.pr);
          if (prStatus === "merged") {
            task.status = "merged";
            merged++;
          }
        }
      }
      if (merged > 0) saveBacklog(backlog);
      notify(ok ? `Pulled main${merged ? `, ${merged} merged` : ""}` : "Pull failed");
      onRefresh();
    }
  });

  // --- Modal views ---

  if (mode === "confirm-delete") {
    return <ConfirmDelete task={tasks[cursor]} onConfirm={() => {
      deleteTask(backlog, tasks[cursor].id);
      setCursor((c) => Math.min(c, tasks.length - 2));
      setMode("list");
      notify(`Deleted: ${tasks[cursor]?.title}`);
      onRefresh();
    }} onCancel={() => setMode("list")} />;
  }

  if (mode === "add") {
    return <TaskForm onSave={(data) => {
      addTask(backlog, data);
      setMode("list");
      notify(`Added: ${data.title}`);
      onRefresh();
    }} onCancel={() => setMode("list")} />;
  }

  if (mode === "edit" && tasks[cursor]) {
    return <TaskForm initial={tasks[cursor]} onSave={(data) => {
      tasks[cursor].title = data.title;
      tasks[cursor].description = data.description;
      tasks[cursor].dependencies = data.dependencies ?? [];
      saveBacklog(backlog);
      setMode("list");
      notify(`Updated: ${data.title}`);
      onRefresh();
    }} onCancel={() => setMode("list")} />;
  }

  // --- List view ---

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Task list */}
      <Box flexDirection="column" flexGrow={1} paddingX={2} overflowY="hidden">
        {tasks.length === 0 ? (
          <Text dimColor>No tasks yet. Press [a] to add one.</Text>
        ) : (
          tasks.map((task, i) => {
            const blocked = task.status === "pending" && task.dependencies.length > 0 && !dependenciesMet(backlog, task);
            return (
              <Box key={task.id}>
                <Text inverse={i === cursor} wrap="truncate">
                  {" "}
                  <Text color={blocked ? "red" : statusColor(task.status)}>{blocked ? "⊘" : statusIcon(task.status)}</Text>
                  {" "}
                  <Text dimColor>{task.id.padEnd(5)}</Text>
                  {task.title.padEnd(40)}
                  <Text dimColor>{(blocked ? "blocked" : task.status).padEnd(10)}</Text>
                  {task.items.length > 0 && (
                    <Text dimColor>
                      {task.items.filter((i) => i.done).length}/{task.items.length}
                    </Text>
                  )}
                  {blocked && (
                    <Text dimColor>  deps: {task.dependencies.join(", ")}</Text>
                  )}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Fixed-height notification slot — always takes 1 row so it doesn't shift layout */}
      <Box paddingX={2} height={1}>
        {notification ? <Text color="yellow">{notification}</Text> : null}
      </Box>
    </Box>
  );
}

function ConfirmDelete({ task, onConfirm, onCancel }: {
  task: Task;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useInput((input) => {
    if (input === "y") onConfirm();
    if (input === "n" || input === "q") onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginY={1}>
      <Text bold color="red">Delete task?</Text>
      <Text>{task.id}: {task.title}</Text>
      <Box marginTop={1}><Text>[y] delete  [n] cancel</Text></Box>
    </Box>
  );
}
