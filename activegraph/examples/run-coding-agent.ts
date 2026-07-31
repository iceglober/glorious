import "dotenv/config";

import { existsSync, readdirSync } from "node:fs";
import { createAzureLlm, createConsoleTracer } from "../index";
import { pendingCommands } from "./approvals";
import {
  type AgentSettings,
  clip,
  createCodingAgent,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_LIMITS,
  DEFAULT_MAX_ROUNDS,
  unfinishedTasks,
  type Workspace,
} from "./coding-agent";
import { formatRunSummary, summarizeRun } from "./run-summary";
import { createShellTool } from "./shell-tool";
import { withProgress } from "./tool-progress";
import { innermostMessage, renderEvent } from "./trace-view";
import { describeChanges } from "./workspace-diff";

/** A goal on the command line runs once; without one, the runner opens a session. */
const goal = process.argv.slice(2).join(" ").trim();
/** Every event with its payload, for debugging the runtime rather than the run. */
const rawTrace = process.env.ACTIVEGRAPH_TRACE === "1";
const model = process.env.ACTIVEGRAPH_MODEL ?? "gpt-4o-mini";
const MAX_ENTRIES = 60;
const MAX_DIRTY = 20;

/**
 * Stdout of a git command, or "" when it is not a repository. Only trailing
 * whitespace goes: a porcelain status line begins with two status columns, so
 * ` M README.md` loses its meaning — and its first path character — if the
 * leading space is trimmed away.
 */
const git = (...args: readonly string[]): string => {
  try {
    const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
    return result.exitCode === 0 ? result.stdout.toString().trimEnd() : "";
  } catch {
    // Spawning fails outright when the working directory has stopped
    // existing, which the agent can arrange: it renamed or deleted it.
    return "";
  }
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
  if (!existsSync(cwd)) {
    // The goal moved or removed the directory the run started in. Saying so is
    // better than crashing after the work is done but before it is reported.
    return { cwd, entries: [] };
  }
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

/** The operator's knobs, which reach the agent as an event like everything else. */
const settings: AgentSettings = {
  model,
  maxRounds: parseInteger(process.env.ACTIVEGRAPH_MAX_ROUNDS, DEFAULT_MAX_ROUNDS, 0),
  historyLimit: parseInteger(process.env.ACTIVEGRAPH_HISTORY, DEFAULT_HISTORY_LIMIT, 0),
  approveCommands: process.env.ACTIVEGRAPH_APPROVE === "1",
  timeoutMs: parseInteger(process.env.ACTIVEGRAPH_COMMAND_TIMEOUT_MS, DEFAULT_LIMITS.timeoutMs, 1),
  maxOutputBytes: parseInteger(
    process.env.ACTIVEGRAPH_MAX_OUTPUT_BYTES,
    DEFAULT_LIMITS.maxOutputBytes,
    1,
  ),
};

const created = await createCodingAgent({
  llm: createAzureLlm({ model }),
  store: { sqlite: process.env.ACTIVEGRAPH_DB ?? "coding-agent.db" },
  tracer: rawTrace
    ? createConsoleTracer((line) => console.error(`[activegraph] ${line}`))
    : {
        onEvent: (event) => {
          const line = renderEvent(event);
          if (line !== null) console.error(line);
        },
      },
  // Commands narrate themselves: the log only learns about them once they
  // have finished, so it cannot say what is running now or for how long.
  tools: withProgress(createShellTool(), { write: (line) => console.error(line) }),
});
if (!created.ok) {
  // Almost always a path that cannot be opened; a stack trace helps nobody.
  console.error(`Could not start: ${JSON.stringify(created.error)}`);
  process.exit(1);
}
const { runtime } = created.value;

// Settings are external input like everything else, and one recording serves
// every goal in the session: the graph holds them from here on.
console.error(`model: ${model}`);
const configured = await runtime.emit("settings.configured", settings);
if (!configured.ok) {
  console.error(`Could not record the settings: ${JSON.stringify(configured.error)}`);
  process.exit(1);
}

// A previous run may have been killed between doing something and recording
// it; the log cannot tell which, so say what it does know.
const unfinished = unfinishedTasks(runtime.view(), process.cwd());
if (unfinished.length > 0) {
  console.error("note: a previous run here did not finish:");
  for (const task of unfinished) {
    console.error(
      `  "${task.request}" (${task.status}, ${task.outstanding} command(s) unfinished)`,
    );
  }
  console.error("  Those commands may have run without their results being recorded.");
}

const currentTaskId = (goal: string): string =>
  runtime
    .view()
    .objects("task")
    .findLast((candidate) => candidate.data.request === goal)?.id ?? "";

/**
 * Show the parked commands and release them only if the operator says so.
 * Each review round parks a fresh batch, hence the loop. A non-interactive
 * stdin makes `prompt` return null, which declines — failing closed is the
 * only safe default for something holding a shell.
 */
const settleApprovals = async (goal: string): Promise<void> => {
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
        taskId: currentTaskId(goal),
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

/**
 * One goal, start to finish. The workspace is sampled per goal rather than per
 * process: in a session the previous goal has usually just changed it.
 */
const runOneGoal = async (goal: string): Promise<void> => {
  // Everything already on the branch belongs to earlier goals; the summary
  // below counts only what this one appended.
  const before = runtime.status().headEventId;
  const workspaceBefore = sampleWorkspace();
  const sampled = await runtime.emit("workspace.sampled", workspaceBefore);
  if (!sampled.ok) {
    console.error(`Could not record the workspace: ${JSON.stringify(sampled.error)}`);
    process.exitCode = 1;
    return;
  }
  // The trace narrates the run as it happens, so there is nothing useful to
  // announce here — only a store or validation failure, which stops everything.
  const result = await runtime.runGoal(goal);
  if (!result.ok) {
    console.error(`Agent failed: ${JSON.stringify(result.error)}`);
    process.exitCode = 1;
    return;
  }
  // Always: even with the gate off, a risky-looking command parks, and leaving
  // it parked without asking would be a silent no.
  await settleApprovals(goal);

  const failures = runtime
    .log()
    .filter((event) => event.id > before && (event.type as string) === "behavior.failed");
  // The readable trace already said this as it happened; the raw one only
  // dumped the payload, so spell it out there.
  if (rawTrace) {
    for (const failure of failures) {
      const { behavior, reason } = failure.payload as { behavior: string; reason: string };
      console.error(`${behavior} failed: ${innermostMessage(reason)}`);
    }
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
    if (command.data.output) console.log(clip(command.data.output, maxOutput));
  }
  if (task?.data.report !== undefined) console.log(`\nreport: ${task.data.report}`);

  // Re-sample and record it, so the log holds the state the goal left behind
  // as well as the one it started from. A command that writes a file usually
  // prints nothing, so its output cannot answer "what changed?".
  const workspaceAfter = sampleWorkspace();
  const resampled = await runtime.emit("workspace.sampled", workspaceAfter);
  if (resampled.ok) await runtime.runUntilIdle();
  const changes = describeChanges(workspaceBefore, workspaceAfter);
  console.log(changes === null ? "\nworking tree: unchanged" : `\nworking tree:\n  ${changes}`);

  const appended = runtime.log().filter((event) => event.id > before);
  console.error(`\n[activegraph] this goal:\n  ${formatRunSummary(summarizeRun(appended))}`);
};

if (goal !== "") {
  await runOneGoal(goal);
} else {
  // A session: each goal sees the previous one in its history and re-samples
  // the directory the previous one just changed, which a fresh process cannot.
  console.error("Enter a goal, or an empty line to finish.");
  for (;;) {
    const line = prompt("\ngoal>");
    const next = line?.trim() ?? "";
    if (next === "" || next === "exit" || next === "quit") break;
    await runOneGoal(next);
  }
}

function parseInteger(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}
