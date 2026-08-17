import type { ToolSet } from "ai";
import { z } from "zod";
import type { Command } from "./commands";
import type { Line, Tone } from "./render";
import type { Question, ToolEvent } from "./tools";
import { wrapTool } from "./tools";

// The public surface an extension is written against. Everything on it is a
// facade over a seam that already exists inside glorious — `tool` lands where
// MCP tools used to be merged, `on` is the internal signal bus made public,
// `exec` is the same shell a sequence runs. Nothing here is a second mechanism
// alongside the first.
//
// Renderers return Line[], glorious's own span structure, never opentui types.
// That is deliberate: the renderer can be swapped without breaking a single
// extension.

export type { Activity, Line, Span, Tone } from "./render";

import type { Activity } from "./render";

export type ShellResult = { output: string; stdout: string; ok: boolean };

export type EventName =
  | "session_start"
  | "session_end"
  | "input"
  | "user_bash"
  | "turn_start"
  | "turn_end"
  | "idle"
  | "message"
  | "before_request"
  | "tool_call"
  | "tool_start"
  | "tool_end"
  | "model_select"
  | "usage"
  | "reasoning"
  | "error";

export type EventPayload = {
  session_start: { root: string };
  // The session is tearing down. Awaited, so an extension gets to finish.
  session_end: { root: string };
  // Returning a string replaces what the user typed; returning false swallows
  // it, which is how an extension handles input itself.
  input: { text: string };
  user_bash: { command: string };
  turn_start: { text: string };
  turn_end: { text: string };
  // The queue drained and nothing is running.
  idle: Record<string, never>;
  // Assistant text and reasoning as they stream.
  message: { kind: "text" | "reasoning"; text: string };
  // Fires before the model is called. Returning a string appends to the
  // per-turn message, which is how an extension injects context for one turn.
  before_request: { prompt: string; messages: number };
  // Fires before a tool runs. Returning false blocks the call and hands the
  // model your reason — this is how a confirm-before-destructive extension, or
  // a read-only mode, is written without the core knowing about either.
  tool_call: { name: string; input: Record<string, unknown> };
  tool_start: { name: string; input: Record<string, unknown> };
  // Returning a string replaces what the model is told the tool returned.
  tool_end: {
    name: string;
    input: Record<string, unknown>;
    ok: boolean;
    result: string;
    detail: string;
    elapsedMs: number;
  };
  model_select: { model: string; variant?: string };
  // Fires once per model call, which is once per step — a turn that runs three
  // tools reports four times. `cached` is what the provider served from its
  // prompt cache rather than reprocessing, so cached/input is the hit rate.
  usage: {
    input: number;
    output: number;
    cached: number;
    cost?: number;
    contextTokens: number;
  };
  // The collapsed reasoning summary, once the model stops thinking.
  reasoning: { text: string; elapsedMs: number };
  // A turn that failed, with the message the transcript shows.
  error: { message: string };
};

// undefined rather than void, so the union is unambiguous: a handler that
// returns nothing leaves the payload alone.
export type HandlerVerdict = undefined | string | false;

export type Handler<E extends EventName> = (
  payload: EventPayload[E],
) => HandlerVerdict | Promise<HandlerVerdict>;

export type ToolSpec<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: Schema;
  execute: (input: z.infer<Schema>, signal: AbortSignal | undefined) => string | Promise<string>;
  // How the row looks while the call runs, and once it has finished. Omit
  // either and glorious draws its usual row.
  renderCall?: (input: z.infer<Schema>) => Line[];
  renderResult?: (result: string, ok: boolean) => Line[];
};

export type CommandSpec = {
  description: string;
  run: (args: string) => void | Promise<void>;
};

// What is loaded right now. Every listing glorious used to ship as a built-in
// command is a view over this and nothing more, which is why none of them are
// built in any longer.
export type Loaded = {
  commands: ReadonlyArray<{ name: string; description: string; origin?: string }>;
  sequences: ReadonlyArray<{ name: string; description: string; origin: string }>;
  skills: ReadonlyArray<{ name: string; description: string; location: string }>;
  extensions: ReadonlyArray<{ name: string; origin: string; contributed: string }>;
};

export type ModelInfo = {
  label: string;
  provider: string;
  modelId: string;
  variant?: string;
  variants?: readonly string[];
  context?: number;
};

export type Usage = {
  /** Context size the provider last reported, or null before the first call. */
  tokens: number | null;
  /** The model's window, when the catalogue knows it. */
  context?: number;
  /** The most recent model call. */
  last?: { input: number; output: number; cached: number; cost?: number };
  /** Summed across the session, including turns replayed from disk on resume. */
  total: { input: number; output: number; cached: number; cost: number; steps: number };
};

export type SessionInfo = {
  id: string;
  file: string;
  title: string;
  events: number;
};

// A keybinding an extension owns. Returning true consumes the key, so the
// composer never sees it — which is what Tab-cycling and Ctrl+B used to be
// before they were core, and what they would be again as extensions.
export type KeySpec = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  description: string;
  run: () => void | Promise<void>;
};

export type FlagSpec = {
  description: string;
  // Called with everything after the flag on the command line.
  run: (value: string) => void | Promise<void>;
};

export type Ui = {
  /** Pick one of a list. Resolves to null if dismissed. */
  select: (title: string, options: readonly string[]) => Promise<string | null>;
  /** Yes/no. Resolves false if dismissed. */
  confirm: (title: string, message?: string) => Promise<boolean>;
  /** Free text. Resolves to null if dismissed. */
  input: (title: string) => Promise<string | null>;
  /** Put text in the composer, ready to edit. */
  setInput: (text: string) => void;
};

export type Glorious = {
  /** The project root every path is resolved against. */
  root: string;
  /**
   * Zod, for describing a tool's input. Handed over rather than imported: an
   * extension in ~/.config/agents/extensions has no node_modules of its own to
   * resolve it from, and one that works in your home directory but not in a
   * project is not a working extension. An extension needs no imports at all.
   */
  z: typeof z;
  /** Register a tool the model can call. */
  tool: <Schema extends z.ZodType>(spec: ToolSpec<Schema>) => void;
  /** Register a slash command the user can type. */
  command: (name: string, spec: CommandSpec) => void;
  /** Bind a key. Only fires when the composer has focus and no overlay is up. */
  key: (spec: KeySpec) => void;
  /** Register a CLI flag: `glorious --name value`. */
  flag: (name: string, spec: FlagSpec) => void;
  /** Subscribe to a lifecycle event. */
  on: <E extends EventName>(event: E, handler: Handler<E>) => void;
  /** Run a shell command in the project root. */
  exec: (command: string, args?: readonly string[]) => Promise<ShellResult>;
  /**
   * Start a turn. `label` is what the transcript shows instead of the text.
   * `steer` jumps the queue so it lands next rather than last.
   */
  send: (text: string, options?: { label?: string; steer?: boolean }) => void;
  /** Write into the transcript. Pass Line[] when you want it styled. */
  print: (content: string | Line[], tone?: Tone) => void;
  /** What is loaded: commands, sequences, skills, extensions. */
  inspect: () => Loaded;
  /** Drop the conversation the model replays. The transcript is untouched. */
  clear: () => "cleared" | "busy" | "empty";
  /** Re-read skills, commands and sequences from disk. */
  reload: () => Promise<void>;

  /** "tui" when a terminal is attached, "print" for a headless -p run. */
  mode: "tui" | "print";
  /** False in print mode: nothing can be asked and nothing can be drawn. */
  hasUI: boolean;
  /** Prompts, pickers and the composer. Throws in print mode. */
  ui: Ui;

  /** The tools the model can currently call. */
  tools: () => readonly string[];
  /**
   * Restrict the model to these tools for the next turn onward. Pass null to
   * lift the restriction. Withholding beats instructing: a tool that is absent
   * cannot be talked into being used.
   */
  setTools: (names: readonly string[] | null) => void;

  /** The model in force, with its context window and reasoning variants. */
  model: () => ModelInfo;
  /** Every model the catalogue knows for the providers you have credentials for. */
  models: () => Promise<readonly ModelInfo[]>;
  /** Switch model, as "provider/model-id". Takes effect on the next turn. */
  setModel: (label: string, variant?: string) => Promise<void>;

  /** Is nothing running and nothing queued? */
  idle: () => boolean;
  /** How many turns are waiting behind the running one. */
  pending: () => number;
  /** Interrupt the running turn. True if there was one. */
  abort: () => boolean;
  /** Tokens, cache hits and cost: the last call and the session total. */
  usage: () => Usage;
  /** The system prompt exactly as the model receives it. */
  systemPrompt: () => string;
  /** Quit glorious. */
  shutdown: () => void;

  /** This session: id, file on disk, title, event count. */
  session: () => SessionInfo;
  /** Rename the session, as the resume picker shows it. */
  setSessionName: (title: string) => void;
  /** Persist your own data in the session file. Never sent to the model. */
  appendEntry: (type: string, data: unknown) => void;

  /** Transform assistant markdown before it is rendered. Display only. */
  markdown: (transform: (text: string) => string) => void;
  /** A bus for extensions to talk to each other. */
  events: {
    emit: (name: string, payload?: unknown) => void;
    on: (name: string, handler: (payload: unknown) => void) => void;
  };
  /** Ask the user, using the same widget the ask_user tool uses. */
  ask: (questions: Question[]) => Promise<string>;
  /** Append a line to the per-turn preamble the model reads. */
  prompt: (text: string) => void;
  /** Contribute a segment to the status line. Return null to show nothing. */
  status: (render: () => string | null) => void;
  /** Draw extra rows above the status line. Return [] to show nothing. */
  footer: (render: () => Line[]) => void;
  /**
   * Replace the activity row — what the turn is doing, how long it has been
   * doing it, and how to stop it. Return null to leave glorious's own. The
   * first extension to return lines wins, so a project can override a personal
   * one the same way it overrides a command.
   */
  activity: (render: (state: Activity) => Line[] | null) => void;
};

// What index.ts hands the API so it can reach the running session. Split out so
// the facade has no idea whether it is talking to a TUI or a print run.
export type ExtensionHost = {
  root: string;
  mode: "tui" | "print";
  exec: (command: string, args?: readonly string[]) => Promise<ShellResult>;
  send: (text: string, options: { label?: string; steer?: boolean }) => void;
  print: (content: string | Line[], tone: Tone) => void;
  ask: (questions: Question[]) => Promise<string>;
  setInput: (text: string) => void;
  inspect: () => Loaded;
  clear: () => "cleared" | "busy" | "empty";
  reload: () => Promise<void>;
  tools: () => readonly string[];
  setTools: (names: readonly string[] | null) => void;
  model: () => ModelInfo;
  models: () => Promise<readonly ModelInfo[]>;
  setModel: (label: string, variant?: string) => Promise<void>;
  idle: () => boolean;
  pending: () => number;
  abort: () => boolean;
  usage: () => Usage;
  systemPrompt: () => string;
  shutdown: () => void;
  session: () => SessionInfo;
  setSessionName: (title: string) => void;
  appendEntry: (type: string, data: unknown) => void;
};

export type ToolRenderer = {
  call?: (input: Record<string, unknown>) => Line[];
  result?: (result: string, ok: boolean) => Line[];
};

// Everything the loaded extensions contributed, in one place, so index.ts can
// merge it into the agent, the command table and the paint without holding a
// reference to any individual extension.
export type Registry = {
  tools: ToolSet;
  commands: Command[];
  runners: Map<string, (args: string) => void | Promise<void>>;
  handlers: Map<EventName, Array<Handler<EventName>>>;
  renderers: Map<string, ToolRenderer>;
  statuses: Array<() => string | null>;
  footers: Array<() => Line[]>;
  activities: Array<(state: Activity) => Line[] | null>;
  promptLines: string[];
  keys: KeySpec[];
  flags: Map<string, FlagSpec>;
  markdown: Array<(text: string) => string>;
  bus: Map<string, Array<(payload: unknown) => void>>;
  // What each extension registered, keyed by its file. /extensions reads this,
  // and it is the only account anyone gets of what a loaded extension did —
  // there being no approval prompt to have read it out beforehand.
  contributions: Map<string, { tools: string[]; commands: string[]; hooks: number; ui: number }>;
};

export const createRegistry = (): Registry => ({
  tools: {},
  commands: [],
  runners: new Map(),
  handlers: new Map(),
  renderers: new Map(),
  statuses: [],
  footers: [],
  activities: [],
  promptLines: [],
  keys: [],
  flags: new Map(),
  markdown: [],
  bus: new Map(),
  contributions: new Map(),
});

export const describeContribution = (registry: Registry, origin: string): string => {
  const entry = registry.contributions.get(origin);
  if (!entry) return "registered nothing";
  const parts = [
    entry.tools.length > 0 && `tools: ${entry.tools.join(", ")}`,
    entry.commands.length > 0 && `commands: ${entry.commands.map((n) => `/${n}`).join(", ")}`,
    entry.hooks > 0 && `${entry.hooks} hook${entry.hooks === 1 ? "" : "s"}`,
    entry.ui > 0 && `${entry.ui} ui`,
  ].filter((part): part is string => typeof part === "string");
  return parts.length === 0 ? "registered nothing" : parts.join(" · ");
};

// A tool an extension registers is announced through the same onEvent the
// built-ins use, so it is late-bound: the agent is built before extensions can
// possibly have run, and this is what lets a tool registered at session_start
// still reach the live row.
export const createApi = (
  host: ExtensionHost,
  registry: Registry,
  onToolEvent: (event: ToolEvent) => void,
  origin: string,
): Glorious => {
  const ledger = { tools: [] as string[], commands: [] as string[], hooks: 0, ui: 0 };
  registry.contributions.set(origin, ledger);
  return {
    root: host.root,
    z,
    tool: (spec) => {
      ledger.tools.push(spec.name);
      registry.tools[spec.name] = wrapTool(
        onToolEvent,
        spec.name,
        spec.description,
        spec.input,
        async (input, signal) => spec.execute(input, signal),
      );
      if (spec.renderCall || spec.renderResult)
        registry.renderers.set(spec.name, {
          call: spec.renderCall as ToolRenderer["call"],
          result: spec.renderResult,
        });
    },
    command: (name, spec) => {
      const slug = name.toLowerCase();
      ledger.commands.push(slug);
      registry.commands.push({ name: slug, description: spec.description, run: null, origin });
      registry.runners.set(slug, spec.run);
    },
    on: (event, handler) => {
      ledger.hooks += 1;
      const bucket = registry.handlers.get(event) ?? [];
      bucket.push(handler as Handler<EventName>);
      registry.handlers.set(event, bucket);
    },
    key: (spec) => {
      ledger.ui += 1;
      registry.keys.push(spec);
    },
    flag: (name, spec) => {
      registry.flags.set(name.replace(/^--/u, ""), spec);
    },
    exec: host.exec,
    send: (text, options = {}) => host.send(text, options),
    print: (content, tone = "muted") => host.print(content, tone),
    ask: host.ask,
    inspect: host.inspect,
    clear: host.clear,
    reload: host.reload,
    prompt: (text) => registry.promptLines.push(text),
    mode: host.mode,
    hasUI: host.mode === "tui",
    ui: {
      select: async (title, options) => {
        const answered = JSON.parse(
          await host.ask([{ question: title, options: [...options] }]),
        ) as { cancelled?: boolean; answers?: Array<{ option: string | null }> };
        if (answered.cancelled) return null;
        return answered.answers?.[0]?.option ?? null;
      },
      confirm: async (title, message) => {
        const answered = JSON.parse(
          await host.ask([
            { question: message ? `${title} — ${message}` : title, options: ["Yes", "No"] },
          ]),
        ) as { cancelled?: boolean; answers?: Array<{ option: string | null }> };
        return !answered.cancelled && answered.answers?.[0]?.option === "Yes";
      },
      input: async (title) => {
        const answered = JSON.parse(
          await host.ask([{ question: title, options: ["Type your answer as a note"] }]),
        ) as { cancelled?: boolean; answers?: Array<{ note?: string }> };
        if (answered.cancelled) return null;
        return answered.answers?.[0]?.note?.trim() || null;
      },
      setInput: host.setInput,
    },
    tools: host.tools,
    setTools: host.setTools,
    model: host.model,
    models: host.models,
    setModel: host.setModel,
    idle: host.idle,
    pending: host.pending,
    abort: host.abort,
    usage: host.usage,
    systemPrompt: host.systemPrompt,
    shutdown: host.shutdown,
    session: host.session,
    setSessionName: host.setSessionName,
    appendEntry: host.appendEntry,
    markdown: (transform) => registry.markdown.push(transform),
    events: {
      emit: (name, payload) => {
        for (const handler of registry.bus.get(name) ?? []) {
          try {
            handler(payload);
          } catch {}
        }
      },
      on: (name, handler) => {
        const bucket = registry.bus.get(name) ?? [];
        bucket.push(handler);
        registry.bus.set(name, bucket);
      },
    },
    status: (render) => {
      ledger.ui += 1;
      registry.statuses.push(render);
    },
    footer: (render) => {
      ledger.ui += 1;
      registry.footers.push(render);
    },
    activity: (render) => {
      ledger.ui += 1;
      registry.activities.push(render);
    },
  };
};

// A handler that throws must not take the turn with it: an extension is
// third-party code and the session is not. The first string a handler returns
// replaces the payload's text; a false stops the chain and swallows the input.
export const fire = async <E extends EventName>(
  registry: Registry,
  event: E,
  payload: EventPayload[E],
  onFailure: (message: string) => void,
): Promise<string | false | undefined> => {
  let replaced: string | undefined;
  for (const handler of registry.handlers.get(event) ?? []) {
    try {
      const said = await handler(payload);
      if (said === false) return false;
      if (typeof said === "string") replaced = said;
    } catch (thrown) {
      onFailure(`${event} handler failed: ${thrown instanceof Error ? thrown.message : thrown}`);
    }
  }
  return replaced;
};
