import z from "zod";
import { createRuntime, llmConfigSchema, type RunResult, type RunStep, type ToolSet } from "../llm";
import { compactModelMessages } from "../llm/continuation";
import {
  type ComposedPrompt,
  composePrompt,
  type PromptContext,
  promptConfigSchema,
} from "../prompt";
import type { Sandbox } from "../sandbox";
import { createBashTools } from "../tools/bash";
import { createEditTools, editConfigSchema } from "../tools/edit";
import { confineSandboxFiles } from "../tools/paths";
import { createSearchTools } from "../tools/search";
import type { SpillWriter } from "../truncation";

/**
 * The agent owns identity/rules and composes the three domain modules the
 * loop needs to think and act: `llm` (which model), `prompt` (how it is told to
 * behave), and `tools` (what it can do). Everything a caller needs to stand up
 * a working agent lives in this one schema, each field defaulted so `{}` is a
 * valid agent.
 */
export const agentConfigSchema = z.object({
  name: z.string().default("glorious"),
  /** Project rules ({{PROJECT_RULES}}), composed with AGENTS.md. */
  rules: z.string().default(""),
  /**
   * Per-turn tool-loop ceiling (model round-trips) — runaway protection, not a
   * work budget. Without it the AI SDK's implicit 20-step default silently
   * truncates long turns. Turns that hit the ceiling surface a notice.
   */
  steps: z.number().int().min(1).default(100),
  llm: llmConfigSchema.prefault({}),
  prompt: promptConfigSchema.prefault({}),
  tools: z
    .object({
      /**
       * Final char cap on every tool result returned to the model. Bash/read
       * output also apply earlier source-specific caps. Over-cap output spills
       * to a session file when spilling is wired, so the cap bounds context
       * growth without losing data.
       */
      maxOutputChars: z.number().int().min(1_000).max(1_000_000).default(30_000),
      edit: editConfigSchema.prefault({}),
    })
    .prefault({}),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export interface CreateAgentOptions {
  /** The session worktree the agent's tools operate in. */
  root: string;
  /** Per-turn environment facts stamped into the prompt footer. */
  ctx: PromptContext;
  /**
   * Session spill store for over-cap tool output: `write` persists the full
   * value, `dir` becomes an extra readable root so the model can slice the
   * spilled file back in. Omitted → over-cap output is plainly truncated.
   */
  spill?: { dir: string; write: SpillWriter };
  /**
   * Live execution feedback: fires when a tool actually starts and ends, so a
   * UI can show what is running now — step-end events alone leave long tool
   * calls invisible.
   */
  onToolActivity?(activity: ToolActivity): void;
  /** Cap the tool loop at N steps. Omitted → the config's `steps` ceiling. */
  stopSteps?: number;
}

/** Per-turn hooks for a single generate() call. */
export interface GenerateOptions {
  abortSignal?: AbortSignal;
  onStep?: (step: RunStep) => void;
  /** Prior turns (RunResult.messages) — the chat loop's opaque continuation. */
  messages?: unknown[];
}

export interface Agent {
  /** The composed prompt, so the caller can log which profile/version it got. */
  composed: ComposedPrompt;
  /** Run one turn: prompt in, final text + trajectory + usage out. */
  generate(prompt: string, opts?: GenerateOptions): Promise<RunResult>;
  /** Drop old tool payloads while retaining a bounded textual history and recent turns. */
  compactContinuation?(messages: unknown[]): unknown[];
}

export interface ToolActivity {
  /** Pairs a start with its end (parallel calls to the same tool differ). */
  id: number;
  tool: string;
  detail: string;
  phase: "start" | "end";
}

/** A one-line label for a tool call, for activity rows. */
const describeToolInput = (input: unknown): string => {
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    if (typeof record.command === "string") return record.command;
    if (typeof record.path === "string") return record.path;
  }
  return JSON.stringify(input) ?? "";
};

/** Wrap every tool's execute with start/end activity callbacks. The minted id
 *  rides along in execute options as `activityId`, so a tool that emits its own
 *  progress events can tag them with the owning activity. */
const withToolActivity = (
  tools: ToolSet,
  onActivity: (activity: ToolActivity) => void,
): ToolSet => {
  let sequence = 0;
  const wrapped: ToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    wrapped[name] = {
      ...def,
      async execute(input, executeOptions) {
        sequence += 1;
        const id = sequence;
        const detail = describeToolInput(input);
        onActivity({ id, tool: name, detail, phase: "start" });
        try {
          return await def.execute(input, { ...(executeOptions as object), activityId: id });
        } finally {
          onActivity({ id, tool: name, detail, phase: "end" });
        }
      },
    };
  }
  return wrapped;
};

/** Assemble the capability boundary independently from model construction. */
export async function createAgentTools(
  sb: Sandbox,
  config: AgentConfig,
  opts: CreateAgentOptions,
): Promise<ToolSet> {
  const fileSandbox = confineSandboxFiles(sb, opts.root);
  const tools: ToolSet = {
    ...(await createBashTools(fileSandbox, {
      root: opts.root,
      maxOutputChars: config.tools.maxOutputChars,
      spill: opts.spill?.write,
    })),
    ...createSearchTools(sb, { root: opts.root }),
    // The edit toolkit carries its own paired readFile (line-prefixed to match
    // the edit contract), so it is the session's read tool as well.
    ...createEditTools(fileSandbox, config.tools.edit.mode),
  };
  return opts.onToolActivity ? withToolActivity(tools, opts.onToolActivity) : tools;
}

/**
 * Build a ready-to-run agent from config: pick the runtime, compose the system
 * prompt for that model, and wire the tools against the sandbox. Returns a
 * `generate` closure plus the ComposedPrompt.
 *
 * Explicit `llm.temperature`/`llm.topP` win over the profile's recommendation;
 * otherwise the profile's advised params (and providerOptions) flow through to
 * every generate() call.
 */
export async function createAgent(
  sb: Sandbox,
  config: AgentConfig,
  opts: CreateAgentOptions,
): Promise<Agent> {
  const runtime = createRuntime(config.llm);

  const composed = composePrompt(
    config.prompt,
    { model: config.llm.model, agentName: config.name, rules: config.rules },
    opts.ctx,
  );

  const tools = await createAgentTools(sb, config, opts);

  return {
    composed,
    compactContinuation: compactModelMessages,
    generate: (prompt, generateOpts) =>
      runtime.generate({
        instructions: composed.instructions,
        prompt,
        messages: generateOpts?.messages,
        tools,
        maxOutputChars: config.tools.maxOutputChars,
        spill: opts.spill?.write,
        temperature: config.llm.temperature ?? composed.params.temperature,
        topP: config.llm.topP ?? composed.params.topP,
        providerOptions: composed.params.providerOptions,
        stopSteps: opts.stopSteps ?? config.steps,
        abortSignal: generateOpts?.abortSignal,
        onStep: generateOpts?.onStep,
      }),
  };
}
