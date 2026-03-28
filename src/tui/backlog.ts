import fs from "node:fs";
import path from "node:path";
import { gitRoot } from "../lib/git.js";
import { generateSpec } from "./spec-gen.js";

export type TaskStatus = "pending" | "active" | "shipped" | "merged";

export interface TaskItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  items: TaskItem[];
  acceptance: string[];
  design: string | null;
  branch: string | null;
  pr: string | null;
  createdAt: string;
  startedAt: string | null;
  shippedAt: string | null;
}

export interface Backlog {
  project: string;
  tasks: Task[];
}

function backlogDir(): string {
  return path.join(gitRoot(), ".wtm");
}

function backlogPath(): string {
  return path.join(backlogDir(), "backlog.json");
}

export function loadBacklog(): Backlog {
  const p = backlogPath();
  if (!fs.existsSync(p)) {
    return { project: path.basename(gitRoot()), tasks: [] };
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function saveBacklog(backlog: Backlog): void {
  const dir = backlogDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(backlogPath(), JSON.stringify(backlog, null, 2) + "\n");
  generateSpec(backlog);
}

function nextId(tasks: Task[]): string {
  let max = 0;
  for (const t of tasks) {
    const n = parseInt(t.id.replace(/^t/, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `t${max + 1}`;
}

export function addTask(
  backlog: Backlog,
  data: { title: string; description: string; items?: TaskItem[]; acceptance?: string[] },
): Task {
  const task: Task = {
    id: nextId(backlog.tasks),
    title: data.title,
    description: data.description,
    status: "pending",
    items: data.items ?? [],
    acceptance: data.acceptance ?? [],
    design: null,
    branch: null,
    pr: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    shippedAt: null,
  };
  backlog.tasks.push(task);
  saveBacklog(backlog);
  return task;
}

export function updateTask(backlog: Backlog, id: string, updates: Partial<Task>): void {
  const task = backlog.tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, updates);
  saveBacklog(backlog);
}

export function deleteTask(backlog: Backlog, id: string): void {
  backlog.tasks = backlog.tasks.filter((t) => t.id !== id);
  saveBacklog(backlog);
}

export function moveTaskUp(backlog: Backlog, index: number): void {
  if (index <= 0) return;
  [backlog.tasks[index - 1], backlog.tasks[index]] = [backlog.tasks[index], backlog.tasks[index - 1]];
  saveBacklog(backlog);
}

export function moveTaskDown(backlog: Backlog, index: number): void {
  if (index >= backlog.tasks.length - 1) return;
  [backlog.tasks[index], backlog.tasks[index + 1]] = [backlog.tasks[index + 1], backlog.tasks[index]];
  saveBacklog(backlog);
}

/** Return the highest-priority pending task, or null if none. */
export function nextPendingTask(backlog: Backlog): Task | null {
  return backlog.tasks.find((t) => t.status === "pending") ?? null;
}
