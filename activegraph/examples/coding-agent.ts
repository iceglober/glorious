/**
 * A small coding agent built from activegraph primitives.
 *
 * A goal is turned into a typed plan by the LLM. Each planned shell command is
 * a graph object, so execution, failures, and the final task state are all
 * durable events that can be replayed and inspected.
 *
 * Five behaviors close a loop: `recorder` folds the sampled workspace into the
 * graph, `planner` turns the goal into commands, `executor` runs each one and
 * writes the output back into the graph, `finisher` settles the task once the
 * newest round of commands is terminal, and `reviewer` reads that output and
 * either reports done or proposes another round. Rounds are bounded by
 * `AgentConfig.maxRounds`.
 *
 * Nothing the agent observes is closed over at construction time. The
 * filesystem arrives as a `workspace.sampled` event, prior goals come from the
 * log, command output comes from the graph — so the branch is self-contained
 * and `replayStrict` re-derives it knowing only which model to name.
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

export const codingAgentSchema = defineSchema({
  objects: {
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
    }),
    command: z.object({
      description: z.string(),
      command: z.string(),
      status: z.enum(["pending", "running", "completed", "failed"]),
      output: z.string().optional(),
      /** Round that proposed this command; the task's status follows the last. */
      round: z.number().optional(),
    }),
  },
  relations: {
    has_command: { source: "task", target: "command" },
  },
  events: { "workspace.sampled": workspaceShape },
});
export type CodingAgentSchema = typeof codingAgentSchema;

export const codingAgentKit = createKit(codingAgentSchema);

/** The single current workspace; a later sample patches it in place. */
export const WORKSPACE_ID = objectId<"workspace">("workspace");

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

/** One round's worth of command objects, each hung off the task. */
const commandMutations = (
  taskId: ObjectId<"task">,
  round: number,
  commands: readonly PlannedCommand[],
): readonly Mutation<CodingAgentSchema>[] =>
  commands.flatMap((item, index) => {
    const commandId = objectId<"command">(`command_${taskId}_r${round}_${index}`);
    const { m } = codingAgentKit;
    return [
      m.addObject("command", { ...item, status: "pending", round }, { id: commandId }),
      m.addRelation("has_command", taskId, commandId),
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

const clip = (value: string, limit: number): string =>
  value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n[…${value.length - limit} more characters]`;

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
 * The execution contract the planner is promised. It travels in the tool
 * input rather than living in the tool implementation, so every `tool.requested`
 * event records where a command ran and under what limits.
 */
export interface CommandLimits {
  /** Wall-clock ceiling; the tool kills the command when it is reached. */
  readonly timeoutMs: number;
  /** Output ceiling, which also bounds what a command can write into the log. */
  readonly maxOutputBytes: number;
}

export const DEFAULT_LIMITS: CommandLimits = { timeoutMs: 120_000, maxOutputBytes: 1_000_000 };

/** What `executor` sends to the "bash" tool; see `examples/shell-tool.ts`. */
export interface BashInput extends CommandLimits {
  readonly command: string;
  readonly cwd: string;
}

/**
 * Knobs that are genuinely the operator's choice. Everything the agent
 * observes — the workspace, prior goals, command output — comes from the graph
 * instead, so a recorded branch replays without reconstructing any of it.
 */
export interface AgentConfig {
  /**
   * Deployment to plan with. Named in the request rather than left to the port
   * so that swapping models re-plans instead of replaying the other model's
   * answer — the adapter honours it (see `adapters/ai-sdk-llm.ts`).
   */
  readonly model: string;
  /** Follow-up rounds the reviewer may add after the initial plan. */
  readonly maxRounds?: number;
  /** Limits attached to every command this agent runs. */
  readonly limits?: CommandLimits;
  /** Earlier goals from this directory to show the planner. 0 disables it. */
  readonly historyLimit?: number;
}

export const DEFAULT_MAX_ROUNDS = 2;
export const DEFAULT_HISTORY_LIMIT = 3;
/**
 * One re-ask when a reply is not usable JSON. A reviewer that fails to parse
 * is the expensive case: its commands have already run, so losing the round
 * means a re-run repeats all of that work.
 */
export const DEFAULT_RETRIES = 1;

/** Ask the model for a bounded, structured implementation plan. */
export const createPlanner = ({ model, historyLimit = DEFAULT_HISTORY_LIMIT }: AgentConfig) =>
  codingAgentKit.llmBehavior({
    name: "planner",
    on: ["goal.created"],
    prompt: (event, view) => ({
      model,
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
        describeHistory(view, workspaceIn(view)?.cwd, historyLimit) +
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
        ...commandMutations(taskId, 0, output.commands),
      ];
    },
  });

/**
 * Execute each planned command through the injected ToolExecutor port, in the
 * directory the planner was shown and under the configured limits — so the
 * prompt's promise about where commands run is enforced, not assumed.
 */
export const createExecutor = ({ limits = DEFAULT_LIMITS }: AgentConfig) =>
  codingAgentKit.behavior({
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
      const input: BashInput = { command: command.command, cwd: workspace.cwd, ...limits };
      const result = await ctx.tool("bash", input);
      const output = result.ok ? stringify(result.value) : stringify(result.error);
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
export const createReviewer = ({ model, maxRounds = DEFAULT_MAX_ROUNDS }: AgentConfig) =>
  codingAgentKit.llmBehavior({
    name: "reviewer",
    on: ["object.patched"],
    where: (event) =>
      event.payload.objectType === "task" &&
      (event.payload.patch.status === "completed" || event.payload.patch.status === "failed"),
    prompt: (event, view) => {
      const task = view.object(event.payload.objectId as ObjectId<"task">);
      const commands = commandsOf(view, event.payload.objectId as ObjectId<"task">);
      const round = task?.data.round ?? 0;
      return {
        model,
        system:
          "You are reviewing a coding agent's finished commands. " +
          "Return JSON only with done, report, and commands. " +
          "Set done to true when the goal is met or nothing further can usefully be run, and leave commands empty. " +
          "Set done to false and return follow-up commands only when the output shows work still to do — a failed command to fix, or a next step the output makes obvious. " +
          "The report must describe what the output actually shows; never claim a result the output does not support.",
        prompt:
          `Workspace:\n${describeWorkspace(workspaceIn(view))}\n\n` +
          `Goal: ${task?.data.request ?? "(unknown)"}\n` +
          `Plan: ${task?.data.summary ?? "(unknown)"}\n` +
          `Rounds used: ${round} of ${maxRounds}\n\n` +
          `Commands run:\n${commands.map(describeCommand).join("\n\n")}`,
      };
    },
    output: review,
    retries: DEFAULT_RETRIES,
    andThen: (output, event, ctx) => {
      const taskId = event.payload.objectId as ObjectId<"task">;
      const task = ctx.view.object(taskId);
      if (task === undefined) return [];
      const round = task.data.round ?? 0;
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
        ...commandMutations(taskId, round + 1, output.commands),
      ];
    },
  });

export const createCodingAgentBehaviors = (
  config: AgentConfig,
): readonly AnyBehavior<CodingAgentSchema>[] => [
  recorder,
  createPlanner(config),
  createExecutor(config),
  finisher,
  createReviewer(config),
];

/** Compose the agent with an LLM and a sandbox/tool implementation. */
export const createCodingAgent = (
  options: AgentConfig & {
    readonly llm: LlmPort;
    readonly tools: ToolExecutor;
    readonly store?: "memory" | { readonly sqlite: string };
    readonly tracer?: TracerSink<CodingAgentSchema>;
  },
) =>
  createDefaultRuntime({
    schema: codingAgentSchema,
    behaviors: createCodingAgentBehaviors(options),
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
