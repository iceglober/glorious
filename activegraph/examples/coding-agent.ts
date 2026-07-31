/**
 * A small coding agent built from activegraph primitives.
 *
 * A goal is turned into a typed plan by the LLM. Each planned shell command is
 * a graph object, so execution, failures, and the final task state are all
 * durable events that can be replayed and inspected.
 *
 * The loop: `settingsRecorder` and `recorder` fold the operator's knobs and
 * the sampled workspace into the graph, `planner` turns the goal into
 * commands, `executor` runs each one and writes the output back, `finisher`
 * settles the task once the newest round of commands is terminal, `reviewer`
 * reads that output and either reports done or proposes another round, and
 * `declineRecorder` records what the operator refused so the reviewer can
 * adapt rather than repeat itself.
 *
 * Nothing the agent depends on is closed over at construction time. The
 * filesystem arrives as `workspace.sampled`, the knobs as `settings.configured`
 * (defaults live in code, which replay already requires to match), prior goals
 * come from the log, command output from the graph — so the branch is
 * self-contained and `replayStrict` re-derives it from the branch alone.
 *
 * That is also what keeps the completion cache honest: it is keyed on the
 * request bytes, so anything the plan depends on has to be *in* the request.
 * Without the workspace in the prompt, the same goal in a different directory
 * hashes identically and replays the previous directory's plan.
 */
import { z } from "zod";
import type { AnyBehavior } from "../domain/behaviors";
import { createKit } from "../domain/behaviors";
import {
  createDefaultRuntime,
  defineSchema,
  type GraphObject,
  type GraphView,
  type Mutation,
  type ObjectId,
  objectId,
} from "../index";
import type { LlmPort } from "../ports/llm";
import type { ToolExecutor } from "../ports/tools";
import type { TracerSink } from "../ports/tracer";

/**
 * Where the planned commands will run. It reaches the agent as an external
 * event rather than as constructor config, so the log records it: replaying a
 * branch needs nothing but the branch.
 */
const workspaceShape = z.object({
  cwd: z.string(),
  /** Enclosing git worktree, when there is one. */
  gitRoot: z.string().optional(),
  /** Checked-out branch, or "HEAD" when detached. */
  branch: z.string().optional(),
  /** Porcelain status lines for uncommitted work, bounded by the sampler. */
  dirty: z.array(z.string()).readonly().optional(),
  /** Top-level entry names; directories carry a trailing "/". */
  entries: z.array(z.string()).readonly(),
});
export type Workspace = z.infer<typeof workspaceShape>;

/**
 * The operator's knobs. They reach the agent as an event for the same reason
 * the workspace does: a branch recorded under `approveCommands` replays as an
 * ungated one if the flag lives in a constructor argument, because the
 * planner's mutations are no longer marked and `approval.proposed` never
 * appears. Defaults live in code, which replay already requires to match;
 * invocation arguments are what a log must not depend on.
 */
const settingsShape = z.object({
  model: z.string(),
  maxRounds: z.number().optional(),
  historyLimit: z.number().optional(),
  approveCommands: z.boolean().optional(),
  timeoutMs: z.number().optional(),
  maxOutputBytes: z.number().optional(),
});
export type AgentSettings = z.infer<typeof settingsShape>;

export const codingAgentSchema = defineSchema({
  objects: {
    settings: settingsShape,
    workspace: workspaceShape,
    task: z.object({
      request: z.string(),
      summary: z.string(),
      status: z.enum(["planned", "running", "completed", "failed"]),
      /** Directory the task ran in; scopes the history a later goal is shown. */
      cwd: z.string().optional(),
      /** How many review rounds have added commands. 0 is the initial plan. */
      round: z.number().optional(),
      /** The reviewer's verdict once it has read the command output. */
      report: z.string().optional(),
      /** Commands the operator refused; the reviewer is told, so it can adapt. */
      declined: z.array(z.string()).readonly().optional(),
    }),
    command: z.object({
      description: z.string(),
      command: z.string(),
      status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
      output: z.string().optional(),
      /** Round that proposed this command; the task's status follows the last. */
      round: z.number().optional(),
    }),
  },
  relations: {
    has_command: { source: "task", target: "command" },
  },
  events: {
    "settings.configured": settingsShape,
    "workspace.sampled": workspaceShape,
    /** The operator refused a parked command. Emitted by the composition root. */
    "command.declined": z.object({
      taskId: z.string(),
      command: z.string(),
      reason: z.string().optional(),
    }),
  },
});
export type CodingAgentSchema = typeof codingAgentSchema;

export const codingAgentKit = createKit(codingAgentSchema);

/** The single current workspace; a later sample patches it in place. */
export const WORKSPACE_ID = objectId<"workspace">("workspace");
export const SETTINGS_ID = objectId<"settings">("settings");

export const DEFAULT_MAX_ROUNDS = 2;
export const DEFAULT_HISTORY_LIMIT = 3;
/**
 * One re-ask when a reply is not usable JSON. A reviewer that fails to parse
 * is the expensive case: its commands have already run, so losing the round
 * means a re-run repeats all of that work.
 */
export const DEFAULT_RETRIES = 1;
export const DEFAULT_LIMITS = { timeoutMs: 120_000, maxOutputBytes: 1_000_000 } as const;

/** Settings as the behaviors see them: recorded values over coded defaults. */
export interface ResolvedSettings {
  readonly model: string;
  readonly maxRounds: number;
  readonly historyLimit: number;
  readonly approveCommands: boolean;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export const settingsIn = (view: GraphView<CodingAgentSchema>): ResolvedSettings => {
  const stored = view.object(SETTINGS_ID)?.data;
  return {
    model: stored?.model ?? "",
    maxRounds: stored?.maxRounds ?? DEFAULT_MAX_ROUNDS,
    historyLimit: stored?.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    approveCommands: stored?.approveCommands ?? false,
    timeoutMs: stored?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxOutputBytes: stored?.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes,
  };
};

/** Fold the operator's knobs into the graph, exactly as `recorder` does. */
export const settingsRecorder = codingAgentKit.behavior({
  name: "settingsRecorder",
  on: ["settings.configured"],
  run: (event, ctx) => {
    if (event.type !== "settings.configured") return [];
    return ctx.view.object(SETTINGS_ID) === undefined
      ? [ctx.m.addObject("settings", event.payload, { id: SETTINGS_ID })]
      : [ctx.m.patchObject("settings", SETTINGS_ID, event.payload)];
  },
});

/**
 * Fold the sampled workspace into the graph. Behaviors read it from there, so
 * nothing about where commands run is closed over at construction time.
 */
export const recorder = codingAgentKit.behavior({
  name: "recorder",
  on: ["workspace.sampled"],
  run: (event, ctx) => {
    if (event.type !== "workspace.sampled") return [];
    return ctx.view.object(WORKSPACE_ID) === undefined
      ? [ctx.m.addObject("workspace", event.payload, { id: WORKSPACE_ID })]
      : [ctx.m.patchObject("workspace", WORKSPACE_ID, event.payload)];
  },
});

/**
 * Record a refusal on the task, and settle the task when the refusal left it
 * with nothing to run. That settle is what turns the gate from a veto into a
 * conversation: a terminal task wakes `reviewer`, which is told what was
 * refused and gets to propose something else within the usual round budget.
 */
export const declineRecorder = codingAgentKit.behavior({
  name: "declineRecorder",
  on: ["command.declined"],
  run: (event, ctx) => {
    if (event.type !== "command.declined") return [];
    const taskId = event.payload.taskId as ObjectId<"task">;
    const task = ctx.view.object(taskId);
    if (task === undefined) return [];
    const declined = [
      ...(task.data.declined ?? []),
      event.payload.reason === undefined
        ? event.payload.command
        : `${event.payload.command} (${event.payload.reason})`,
    ];
    const round = task.data.round ?? 0;
    const outstanding = commandsOf(ctx.view, taskId).some(
      (command) => (command.data.round ?? 0) === round,
    );
    return [
      ctx.m.patchObject("task", taskId, {
        declined,
        // Nothing from this round survived the gate, so no command patch will
        // ever arrive to let `finisher` settle it.
        ...(outstanding || task.data.status === "completed" || task.data.status === "failed"
          ? {}
          : { status: "failed" as const }),
      }),
    ];
  },
});

const MAX_COMMANDS = 8;
/** Per-command output budget in the reviewer's prompt; the rest is dropped. */
const MAX_OUTPUT_IN_PROMPT = 2_000;
/** Per-task budget for the history the planner is shown. */
const MAX_HISTORY_CHARS = 400;

const commandItem = z.union([
  z.object({ description: z.string(), command: z.string() }),
  z.string(),
]);

type PlannedCommand = { readonly description: string; readonly command: string };

const normalize = (items: readonly z.infer<typeof commandItem>[]): readonly PlannedCommand[] =>
  items.map((item) => (typeof item === "string" ? { description: item, command: item } : item));

const plan = z
  .object({
    summary: z.string(),
    commands: z.array(commandItem).min(1).max(MAX_COMMANDS),
  })
  .transform((value) => ({ summary: value.summary, commands: normalize(value.commands) }));

const review = z
  .object({
    done: z.boolean(),
    report: z.string(),
    commands: z.array(commandItem).max(MAX_COMMANDS).default([]),
  })
  .transform((value) => ({
    done: value.done,
    report: value.report,
    commands: normalize(value.commands),
  }));

/**
 * Commands that always wait for a person, whatever the configuration.
 *
 * This used to be a blocklist in the shell tool, which was the wrong answer
 * twice over. It matched text rather than intent, so a model told "no" to
 * `rm -rf` returned the same deletion in Python and walked straight past it;
 * and a flat refusal is exactly the signal that provokes the rewrite. Asking
 * instead of refusing keeps the accident case covered — a careless `rm -rf`
 * still cannot run unseen — without pretending to stop a determined one, and
 * without teaching the model to work around the guard.
 */
/**
 * Where the next word is a program being run: the start of the line, after a
 * separator, or handed to something that execs its argument. Requiring one of
 * these is what keeps `grep -r "sudo" .` and `cat notes/dd/readme.md` quiet —
 * a prompt that cries wolf is one the operator stops reading, and reading it
 * is the entire mechanism.
 */
const COMMAND_POSITION = String.raw`(?:^|[\n;|&(]|\$\(|\x60|(?:^|\s)(?:-exec|-execdir|xargs|env|nohup|time|-c)\s+)\s*['"]?\s*`;

/** Programs that are destructive whatever their arguments. */
const RISKY_PROGRAM = String.raw`(?:sudo|mkfs\S*|dd|shutdown|reboot)\s`;

/**
 * Actions that are destructive in a particular form. Anchored the same way, so
 * `echo "rm -rf is dangerous"` is prose and `find . -exec rm -rf {} +` is not.
 */
const RISKY_ACTION = String.raw`(?:\brm\s+-[a-z]*[rf]|\bgit\s+reset\s+--hard|\bgit\s+clean\s+-[a-z]*f|\bgit\s+push\s+[^;|&]*(?:--force|-f)(?:\s|$))`;

export const RISKY_COMMAND = new RegExp(
  `${COMMAND_POSITION}(?:${RISKY_PROGRAM}|${RISKY_ACTION})`,
  "i",
);

export const looksDestructive = (command: string): boolean => RISKY_COMMAND.test(command);

/**
 * One round's worth of command objects, each hung off the task.
 *
 * A gated command parks both mutations behind `approval.proposed` instead of
 * applying. Nothing runs, because the executor fires on `object.created` and
 * that event never happens until the gate is released — so the operator sees
 * the shell command before the shell does. The relation is gated too: it
 * cannot attach to an object that does not exist yet.
 */
const commandMutations = (
  taskId: ObjectId<"task">,
  round: number,
  commands: readonly PlannedCommand[],
  gate: boolean,
): readonly Mutation<CodingAgentSchema>[] =>
  commands.flatMap((item, index) => {
    const commandId = objectId<"command">(`command_${taskId}_r${round}_${index}`);
    const { m } = codingAgentKit;
    const approval =
      gate || looksDestructive(item.command) ? ({ requiresApproval: true } as const) : {};
    return [
      m.addObject("command", { ...item, status: "pending", round }, { id: commandId, ...approval }),
      m.addRelation("has_command", taskId, commandId, approval),
    ];
  });

const commandsOf = (
  view: GraphView<CodingAgentSchema>,
  taskId: ObjectId<"task">,
): readonly GraphObject<CodingAgentSchema, "command">[] =>
  view
    .relations("has_command")
    .filter((relation) => relation.source === taskId)
    .map((relation) => view.object(relation.target))
    .filter(
      (command): command is GraphObject<CodingAgentSchema, "command"> => command !== undefined,
    );

/**
 * Whether an earlier command of the same round already failed. Commands of a
 * round are created together and dispatched in order, so by the time this runs
 * every earlier sibling has settled.
 */
const failedEarlierInRound = (
  view: GraphView<CodingAgentSchema>,
  commandId: ObjectId<"command">,
): boolean => {
  const edge = view.relations("has_command").find((relation) => relation.target === commandId);
  if (edge === undefined) return false;
  const round = view.object(commandId)?.data.round ?? 0;
  for (const sibling of commandsOf(view, edge.source)) {
    if (sibling.id === commandId) break;
    if ((sibling.data.round ?? 0) === round && sibling.data.status === "failed") return true;
  }
  return false;
};

/**
 * One line, middle elided. For anywhere a command has to fit on a single line:
 * `clip` would inject its marker as a new line, and a command can contain
 * newlines of its own — the model writes heredocs.
 */
export const elide = (value: string, limit: number): string => {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  const half = Math.floor((limit - 1) / 2);
  return `${single.slice(0, half)}…${single.slice(-half)}`;
};

/**
 * Truncate from the middle, keeping both ends.
 *
 * A long command's most useful line is usually its last: the test summary, the
 * error that stopped the build, the path it finally wrote. Head-only
 * truncation feeds the reviewer the preamble and drops the verdict, which is
 * the one part it needs to judge the round.
 */
export const clip = (value: string, limit: number): string => {
  if (value.length <= limit) return value;
  const shape = (dropped: number) => `\n[… ${dropped} characters dropped …]\n`;
  // The marker's own length changes how much fits, and its digits change with
  // the count; two passes settle it, so the number printed is the true one.
  let marker = shape(value.length);
  for (let pass = 0; pass < 3; pass += 1) {
    marker = shape(value.length - Math.max(0, limit - marker.length));
  }
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available / 2);
  const tail = available - head;
  return `${value.slice(0, head)}${marker}${tail === 0 ? "" : value.slice(-tail)}`;
};

const describeCommand = (command: GraphObject<CodingAgentSchema, "command">): string =>
  [
    `- ${command.data.description} [round ${command.data.round ?? 0}, ${command.data.status}]`,
    `  $ ${command.data.command}`,
    clip(command.data.output ?? "(no output)", MAX_OUTPUT_IN_PROMPT),
  ].join("\n");

/**
 * What this workspace has already been asked to do. The log outlives a single
 * run, so a second goal can build on the first instead of rediscovering the
 * project — and because it lands in the prompt, it is part of the cache key
 * like every other thing the plan depends on.
 *
 * Scoped by `cwd`: one shared event log may serve several directories, and
 * another project's history is noise at best and misleading at worst.
 */
const describeHistory = (
  view: GraphView<CodingAgentSchema>,
  cwd: string | undefined,
  limit: number,
): string => {
  if (cwd === undefined) return "";
  const past = view
    .objects("task")
    .filter(
      (task) =>
        task.data.cwd === cwd &&
        (task.data.status === "completed" || task.data.status === "failed"),
    )
    .slice(-limit);
  if (past.length === 0 || limit === 0) return "";
  const lines = past.map(
    (task) =>
      `- [${task.data.status}] ${task.data.request}\n  ${clip(
        task.data.report ?? task.data.summary,
        MAX_HISTORY_CHARS,
      )}`,
  );
  return `Earlier goals in this workspace, oldest first:\n${lines.join("\n")}\n\n`;
};

/**
 * Earlier rounds as one line each. Their full output is already spent: the
 * reviewer decided about it when the round settled, and re-sending it every
 * round is the resent-context that dominates what a run costs. What still
 * matters is what was tried and how it went.
 */
const describeEarlierRounds = (
  commands: readonly GraphObject<CodingAgentSchema, "command">[],
): string => {
  const newest = Math.max(0, ...commands.map((command) => command.data.round ?? 0));
  const earlier = commands.filter((command) => (command.data.round ?? 0) < newest);
  if (earlier.length === 0) return "";
  const lines = earlier.map(
    (command) =>
      `- [round ${command.data.round ?? 0}, ${command.data.status}] ${elide(command.data.command, 120)}`,
  );
  return `Earlier rounds, already reviewed:\n${lines.join("\n")}\n\n`;
};

const describeDeclined = (declined: readonly string[] | undefined): string =>
  declined === undefined || declined.length === 0
    ? ""
    : `Refused by the operator, do not propose these again:\n${declined
        .map((command) => `- ${command}`)
        .join("\n")}\n\n`;

/** Commands from the newest round — the ones the task's status reflects. */
const latestRound = <T extends { readonly data: { readonly round?: number } }>(
  commands: readonly T[],
): readonly T[] => {
  const newest = Math.max(0, ...commands.map((command) => command.data.round ?? 0));
  return commands.filter((command) => (command.data.round ?? 0) === newest);
};

const workspaceIn = (view: GraphView<CodingAgentSchema>): Workspace | undefined =>
  view.object(WORKSPACE_ID)?.data;

const describeGit = (workspace: Workspace): readonly string[] => {
  if (workspace.gitRoot === undefined) return ["Git: not a repository"];
  const dirty = workspace.dirty ?? [];
  return [
    `Git root: ${workspace.gitRoot}${
      workspace.branch === undefined ? "" : ` (branch ${workspace.branch})`
    }`,
    dirty.length === 0
      ? "Uncommitted changes: none"
      : `Uncommitted changes:\n${dirty.map((line) => `  ${line}`).join("\n")}`,
  ];
};

const describeWorkspace = (workspace: Workspace | undefined): string =>
  workspace === undefined
    ? "No workspace has been sampled; emit workspace.sampled before the goal."
    : [
        `Working directory: ${workspace.cwd}`,
        ...describeGit(workspace),
        `Top-level entries: ${
          workspace.entries.length === 0 ? "(none)" : workspace.entries.join(", ")
        }`,
      ].join("\n");

/**
 * What `executor` sends to the "bash" tool; see `examples/shell-tool.ts`. The
 * limits travel in the input rather than living in the tool, so every
 * `tool.requested` event records where a command ran and under what ceilings.
 */
export interface BashInput {
  readonly command: string;
  readonly cwd: string;
  /** Wall-clock ceiling; the tool kills the command when it is reached. */
  readonly timeoutMs: number;
  /** Output ceiling, which also bounds what a command can write to the log. */
  readonly maxOutputBytes: number;
}

/** Ask the model for a bounded, structured implementation plan. */
export const planner = codingAgentKit.llmBehavior({
  name: "planner",
  on: ["goal.created"],
  prompt: (event, view) => ({
    model: settingsIn(view).model,
    system:
      "You are a careful coding agent with shell access to the current working directory through the commands you return. " +
      "Return JSON only with summary and commands. Commands must be non-interactive and directly useful for the requested change. " +
      "Plan for the workspace described in the message; prefer the paths listed there over guesses, and do not assume files that are not listed. " +
      "Treat uncommitted changes as work in progress: never discard, stash, or check out over them unless the goal says to. " +
      "Build on the earlier goals when they are relevant, and do not redo work they already finished. " +
      "Do not claim that files, repository contents, or shell access are unavailable. " +
      "The summary must describe the work the commands will perform, not pretend that commands have already been run.",
    prompt:
      `Workspace:\n${describeWorkspace(workspaceIn(view))}\n\n` +
      describeHistory(view, workspaceIn(view)?.cwd, settingsIn(view).historyLimit) +
      `Goal: ${event.payload.text}\n\n` +
      "Create a concise command plan. The commands will be executed in that working directory after you respond, and their output will be shown separately.",
  }),
  output: plan,
  retries: DEFAULT_RETRIES,
  andThen: (output, event, ctx) => {
    const taskId = objectId<"task">(`task_${event.payload.goalId}`);
    return [
      ctx.m.addObject(
        "task",
        {
          request: event.payload.text,
          summary: output.summary,
          status: "planned",
          ...(workspaceIn(ctx.view) === undefined ? {} : { cwd: workspaceIn(ctx.view)?.cwd }),
          round: 0,
        },
        { id: taskId },
      ),
      ...commandMutations(taskId, 0, output.commands, settingsIn(ctx.view).approveCommands),
    ];
  },
});

/**
 * Execute each planned command through the injected ToolExecutor port, in the
 * directory the planner was shown and under the configured limits — so the
 * prompt's promise about where commands run is enforced, not assumed.
 */
export const executor = codingAgentKit.behavior({
  name: "executor",
  on: ["object.created"],
  where: (event) => event.payload.objectType === "command",
  run: async (event, ctx) => {
    if (event.type !== "object.created" || event.payload.objectType !== "command") return [];
    const command = event.payload.data;
    const workspace = workspaceIn(ctx.view);
    // Refuse rather than guess: running somewhere the plan never saw is
    // worse than a recorded failure that says why.
    if (workspace === undefined) {
      return [
        ctx.m.patchObject("command", event.payload.objectId, {
          status: "failed",
          output: "No workspace has been sampled; emit workspace.sampled before the goal.",
        }),
      ];
    }
    // A plan is a sequence, not a set: "create the directory, then write into
    // it" is broken the moment the first step fails, and running the rest can
    // do damage the reviewer then has to undo. One failure ends the round.
    if (failedEarlierInRound(ctx.view, event.payload.objectId)) {
      return [
        ctx.m.patchObject("command", event.payload.objectId, {
          status: "skipped",
          output: "Skipped: an earlier command in this round failed.",
        }),
      ];
    }
    const { timeoutMs, maxOutputBytes } = settingsIn(ctx.view);
    const input: BashInput = {
      command: command.command,
      cwd: workspace.cwd,
      timeoutMs,
      maxOutputBytes,
    };
    const result = await ctx.tool("bash", input);
    // A failure is a sentence, not a payload. This string is what the reviewer
    // reads and what the operator sees printed, so `{"reason":"tool_error",
    // "message":"..."}` costs tokens and clarity for nothing.
    const output = result.ok
      ? stringify(result.value)
      : "message" in result.error
        ? result.error.message
        : result.error.reason;
    return [
      ctx.m.patchObject("command", event.payload.objectId, {
        status: result.ok ? "completed" : "failed",
        output,
      }),
    ];
  },
});

/**
 * Mark the task once the newest round's commands have all reached a terminal
 * state. Only the newest round counts: a retry that fixes a failed command
 * should be able to bring the task back to `completed`, and earlier rounds
 * stay in the graph as history.
 */
export const finisher = codingAgentKit.behavior({
  name: "finisher",
  on: ["object.patched"],
  where: (event) => event.payload.objectType === "command",
  run: (event, ctx) => {
    if (event.type !== "object.patched" || event.payload.objectType !== "command") return [];
    const edge = ctx.view
      .relations("has_command")
      .find((relation) => relation.target === event.payload.objectId);
    if (edge === undefined) return [];
    const task = ctx.view.object(edge.source);
    if (task === undefined || task.data.status === "completed" || task.data.status === "failed")
      return [];
    const commands = latestRound(commandsOf(ctx.view, edge.source));
    if (
      commands.some(
        (command) => command.data.status === "pending" || command.data.status === "running",
      )
    ) {
      return task.data.status === "planned"
        ? [ctx.m.patchObject("task", task.id, { status: "running" })]
        : [];
    }
    return [
      ctx.m.patchObject("task", task.id, {
        status: commands.some((command) => command.data.status === "failed")
          ? "failed"
          : "completed",
      }),
    ];
  },
});

/**
 * Read the finished commands and decide: done, or another round. This is what
 * makes the example an agent rather than a one-shot planner — the output the
 * executor wrote into the graph is fed back to the model, so a failed command
 * or a surprising result can be answered with more work.
 *
 * Bounded by `maxRounds`, and self-limiting by construction: it only fires when
 * a task *becomes* terminal, and its own follow-up patch sets `running`.
 */
export const reviewer = codingAgentKit.llmBehavior({
  name: "reviewer",
  on: ["object.patched"],
  where: (event) =>
    event.payload.objectType === "task" &&
    (event.payload.patch.status === "completed" || event.payload.patch.status === "failed"),
  prompt: (event, view) => {
    const task = view.object(event.payload.objectId as ObjectId<"task">);
    const commands = commandsOf(view, event.payload.objectId as ObjectId<"task">);
    const round = task?.data.round ?? 0;
    const { model, maxRounds } = settingsIn(view);
    return {
      model,
      system:
        "You are reviewing a coding agent's finished commands. " +
        "Return JSON only with done, report, and commands. " +
        "Set done to true when the goal is met or nothing further can usefully be run, and leave commands empty. " +
        "Set done to false and return follow-up commands only when the output shows work still to do — a failed command to fix, or a next step the output makes obvious. " +
        "A command marked skipped never ran, because an earlier one in its round failed; fix that failure and propose the skipped work again if it is still needed. " +
        "A refused command was rejected by the operator: do not propose it again. " +
        "Do not reach the same effect by other means either — a different tool or language for the same action is still the refused action. " +
        "Propose a narrower step, one that shows what would change without changing it, or set done to true and say the work needs the operator. " +
        "The report must describe what the output actually shows; never claim a result the output does not support.",
      prompt:
        `Workspace, as sampled before the commands ran:\n${describeWorkspace(workspaceIn(view))}\n\n` +
        `Goal: ${task?.data.request ?? "(unknown)"}\n` +
        `Plan: ${task?.data.summary ?? "(unknown)"}\n` +
        `Rounds used: ${round} of ${maxRounds}\n\n` +
        describeDeclined(task?.data.declined) +
        describeEarlierRounds(commands) +
        `Commands run:\n${
          commands.length === 0 ? "(none)" : latestRound(commands).map(describeCommand).join("\n\n")
        }`,
    };
  },
  output: review,
  retries: DEFAULT_RETRIES,
  andThen: (output, event, ctx) => {
    const taskId = event.payload.objectId as ObjectId<"task">;
    const task = ctx.view.object(taskId);
    if (task === undefined) return [];
    const round = task.data.round ?? 0;
    const { maxRounds, approveCommands } = settingsIn(ctx.view);
    const exhausted = round >= maxRounds;
    if (output.done || output.commands.length === 0 || exhausted) {
      const note =
        output.done || output.commands.length === 0
          ? ""
          : `\n\n(Stopped after ${maxRounds} round(s) with follow-up work still proposed.)`;
      return [ctx.m.patchObject("task", taskId, { report: `${output.report}${note}` })];
    }
    return [
      ctx.m.patchObject("task", taskId, {
        status: "running",
        round: round + 1,
        report: output.report,
      }),
      ...commandMutations(taskId, round + 1, output.commands, approveCommands),
    ];
  },
});

export const codingAgentBehaviors: readonly AnyBehavior<CodingAgentSchema>[] = [
  settingsRecorder,
  recorder,
  declineRecorder,
  planner,
  executor,
  finisher,
  reviewer,
];

/**
 * Kept as a function for call sites that read better that way; there is
 * nothing left to configure, because the settings now arrive as an event.
 */
export const createCodingAgentBehaviors = (): readonly AnyBehavior<CodingAgentSchema>[] =>
  codingAgentBehaviors;

/** Compose the agent with an LLM and a sandbox/tool implementation. */
export const createCodingAgent = (options: {
  readonly llm: LlmPort;
  readonly tools: ToolExecutor;
  readonly store?: "memory" | { readonly sqlite: string };
  readonly tracer?: TracerSink<CodingAgentSchema>;
}) =>
  createDefaultRuntime({
    schema: codingAgentSchema,
    behaviors: codingAgentBehaviors,
    llm: options.llm,
    tools: options.tools,
    store: options.store,
    tracer: options.tracer,
  });

const stringify = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));

/** Mutations useful for provisioning a task without going through the planner. */
export const codingAgentMutations = {
  task: (request: string, summary: string): Mutation<CodingAgentSchema> =>
    codingAgentKit.m.addObject("task", { request, summary, status: "planned" }),
};
