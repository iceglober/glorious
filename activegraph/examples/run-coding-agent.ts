import "dotenv/config";

import { readdirSync } from "node:fs";
import { createAzureLlm, createConsoleTracer, unwrap } from "../index";
import { pendingCommands } from "./approvals";
import {
  createCodingAgent,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_LIMITS,
  DEFAULT_MAX_ROUNDS,
  type Workspace,
} from "./coding-agent";
import { formatRunSummary, summarizeRun } from "./run-summary";
import { createShellTool } from "./shell-tool";

const goal = process.argv.slice(2).join(" ") || "Inspect this project";
const model = process.env.ACTIVEGRAPH_MODEL ?? "gpt-4o-mini";
const MAX_ENTRIES = 60;
const MAX_DIRTY = 20;

/** Trimmed stdout of a git command, or "" when it is not a repository. */
const git = (...args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
};

/** Cap a list, saying how much was dropped rather than truncating in silence. */
const capped = (values: readonly string[], limit: number): readonly string[] =>
  values.length <= limit
    ? values
    : [...values.slice(0, limit), `…and ${values.length - limit} more`];

/**
 * Sample the directory the plan will run in: what is on disk, which branch is
 * checked out, and what is uncommitted. This is the agent's whole view of the
 * world, and it enters through an event, so the log keeps it.
 */
const sampleWorkspace = (): Workspace => {
  const cwd = process.cwd();
  const gitRoot = git("rev-parse", "--show-toplevel");
  const branch = gitRoot === "" ? "" : git("rev-parse", "--abbrev-ref", "HEAD");
  const status = gitRoot === "" ? "" : git("status", "--porcelain");
  const dirty = status === "" ? [] : capped(status.split("\n"), MAX_DIRTY);
  const names = readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
  return {
    cwd,
    entries: capped(names, MAX_ENTRIES),
    ...(gitRoot === "" ? {} : { gitRoot, dirty }),
    ...(branch === "" ? {} : { branch }),
  };
};

const { runtime } = await unwrap(
  createCodingAgent({
    llm: createAzureLlm({ model }),
    model,
    maxRounds: parseInteger(process.env.ACTIVEGRAPH_MAX_ROUNDS, DEFAULT_MAX_ROUNDS, 0),
    historyLimit: parseInteger(process.env.ACTIVEGRAPH_HISTORY, DEFAULT_HISTORY_LIMIT, 0),
    approveCommands: process.env.ACTIVEGRAPH_APPROVE === "1",
    limits: {
      timeoutMs: parseInteger(
        process.env.ACTIVEGRAPH_COMMAND_TIMEOUT_MS,
        DEFAULT_LIMITS.timeoutMs,
        1,
      ),
      maxOutputBytes: parseInteger(
        process.env.ACTIVEGRAPH_MAX_OUTPUT_BYTES,
        DEFAULT_LIMITS.maxOutputBytes,
        1,
      ),
    },
    store: { sqlite: process.env.ACTIVEGRAPH_DB ?? "coding-agent.db" },
    tracer: createConsoleTracer((line) => console.error(`[activegraph] ${line}`)),
    tools: createShellTool(),
  }),
);

// Everything already on the branch belongs to earlier runs; the summary at the
// end counts only what this one appended.
const before = runtime.status().headEventId;

console.error(`Planning with ${model}...`);
// The workspace is external input, so it enters through an event: the log
// then holds everything the plan depended on and can be replayed on its own.
const sampled = await runtime.emit("workspace.sampled", sampleWorkspace());
if (!sampled.ok) {
  console.error(`Could not record the workspace: ${JSON.stringify(sampled.error)}`);
  process.exit(1);
}
const result = await runtime.runGoal(goal);
if (!result.ok) {
  console.error(`Agent failed: ${JSON.stringify(result.error)}`);
  process.exitCode = 1;
} else {
  console.error("Plan received; executing commands...");
}

/**
 * Show the parked commands and release them only if the operator says so.
 * Each review round parks a fresh batch, hence the loop. A non-interactive
 * stdin makes `prompt` return null, which declines — failing closed is the
 * only safe default for something holding a shell.
 */
const currentTaskId = (): string =>
  runtime
    .view()
    .objects("task")
    .findLast((candidate) => candidate.data.request === goal)?.id ?? "";

const settleApprovals = async (): Promise<void> => {
  const declined = new Set<string>();
  for (;;) {
    const pending = runtime.status().pendingApprovals.filter((id) => !declined.has(id));
    if (pending.length === 0) return;

    console.log("\nThe agent wants to run:");
    const granting: string[] = [];
    let rest = false;
    for (const group of pendingCommands(runtime.log(), pending)) {
      // Models often echo the command as its own description; showing it twice
      // doubles the line length of the thing the operator has to read.
      const note =
        group.description === "" || group.description === group.command
          ? ""
          : `   # ${group.description}`;
      console.log(`  $ ${group.command}${note}`);
      const answer = rest
        ? "y"
        : (prompt("    run it? [y/N/a=yes to all]") ?? "").trim().toLowerCase();
      if (answer === "a") rest = true;
      if (rest || answer === "y") {
        granting.push(...group.approvalIds);
        continue;
      }
      for (const approvalId of group.approvalIds) declined.add(approvalId);
      // Tell the agent, not just the gate: the reviewer reads refusals and
      // gets a round to propose something you might actually allow.
      const refused = await runtime.emit("command.declined", {
        taskId: currentTaskId(),
        command: group.command,
      });
      if (!refused.ok) {
        console.error(`Could not record the refusal: ${JSON.stringify(refused.error)}`);
      }
    }
    // In proposal order, so each command object lands before its relation.
    for (const approvalId of granting) {
      const granted = await runtime.grantApproval(approvalId);
      if (!granted.ok) {
        console.error(`Could not grant ${approvalId}: ${JSON.stringify(granted.error)}`);
        return;
      }
    }
    // Drains the grants and any refusals recorded above, either of which can
    // wake the reviewer for another round.
    const drained = await runtime.runUntilIdle();
    if (!drained.ok) {
      console.error(`Agent failed: ${JSON.stringify(drained.error)}`);
      process.exitCode = 1;
      return;
    }
    if (
      granting.length === 0 &&
      runtime.status().pendingApprovals.every((id) => declined.has(id))
    ) {
      console.log("Nothing approved.");
    }
  }
};

if (process.env.ACTIVEGRAPH_APPROVE === "1") await settleApprovals();

const failures = runtime.log().filter((event) => (event.type as string) === "behavior.failed");
for (const failure of failures) {
  console.error(`Behavior failed: ${JSON.stringify(failure.payload)}`);
}
if (failures.length > 0) process.exitCode = 1;

const task = runtime
  .view()
  .objects("task")
  .findLast((candidate) => candidate.data.request === goal);
if (task !== undefined) {
  console.log(`${task.data.status}: ${task.data.request}`);
  console.log(`summary: ${task.data.summary}`);
}
const commandIds = new Set(
  task === undefined
    ? []
    : runtime
        .view()
        .relations("has_command")
        .filter((relation) => relation.source === task.id)
        .map((relation) => relation.target),
);
const maxOutput = parseInteger(process.env.ACTIVEGRAPH_MAX_OUTPUT, 4_000, 1);
let round = -1;
for (const command of runtime.view().objects("command")) {
  if (!commandIds.has(command.id)) continue;
  const commandRound = command.data.round ?? 0;
  if (commandRound !== round) {
    round = commandRound;
    console.log(round === 0 ? "\n--- plan ---" : `\n--- review round ${round} ---`);
  }
  console.log(`$ ${command.data.command}`);
  if (command.data.output) console.log(truncate(command.data.output, maxOutput));
}
if (task?.data.report !== undefined) console.log(`\nreport: ${task.data.report}`);
const appended = runtime.log().filter((event) => event.id > before);
console.error(`\n[activegraph] this run:\n  ${formatRunSummary(summarizeRun(appended))}`);

function parseInteger(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = `\n... [truncated ${value.length - limit} characters; limit ${limit}] ...\n`;
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${value.slice(0, head)}${marker}${tail === 0 ? "" : value.slice(-tail)}`;
}
