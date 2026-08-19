import type { ModelMessage, ToolSet } from "ai";
import { z } from "zod";
import type { Scope, Settings } from "../../glrs-core/src";
import type { ShellResult as ToolShellResult } from "../../glrs-core/src/shell";
import type { Compaction } from "./chat";
import type { Command } from "./commands";
import { clip, type Line, type Tone } from "./render";
import type { SkillSummary } from "./skills";
import type { ToolEvent } from "./toolkit";
import { wrapTool } from "./toolkit";

// The public surface an extension is written against. Everything on it is a
// facade over a seam that already exists inside glrs — `tool` lands where
// MCP tools used to be merged, `on` is the internal signal bus made public,
// `exec` is the same shell the `!` command runs. Nothing here is a second mechanism
// alongside the first.
//
// Renderers return Line[], glrs's own span structure, never opentui types.
// That is deliberate: the renderer can be swapped without breaking a single
// extension.

export type { Compaction } from "./chat";
export type { Activity, Line, Span, Tone } from "./render";

import type { Activity } from "./render";

// One definition, in core, where both the coding agent and the tools extension
// can reach it. This was briefly declared here as well; two copies of one shape
// is two things to remember to change, and the last pair had already drifted.
export type ShellResult = ToolShellResult;

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
  | "error"
  | "compact"
  | "context"
  | "before_provider_request"
  | "after_provider_response";

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
  // The conversation was summarised to stay inside the context limit.
  compact: { dropped: number; kept: number; automatic: boolean };
  // Every message about to be sent, before each model call. Returning an array
  // replaces what is sent for that call only — the stored conversation is
  // untouched, so filtering or reordering here never rewrites history.
  //
  // `before_request` appends a string to the turn's message; this replaces the
  // whole list, which is what redaction, windowing and message-level rewriting
  // need and appending cannot do.
  context: { messages: readonly ModelMessage[]; step: number };
  // The HTTP request to the provider, before it is sent. Returning headers
  // merges them; returning a body replaces it outright. A gateway, a signing
  // proxy, per-request auth and request logging all live here.
  before_provider_request: {
    url: string;
    headers: Readonly<Record<string, string>>;
    body: unknown;
  };
  // The provider's response, before its body is read. Observational: status and
  // headers are what rate-limit budgets and request ids arrive in.
  after_provider_response: {
    url: string;
    status: number;
    headers: Readonly<Record<string, string>>;
  };
};

// undefined rather than void, so the union is unambiguous: a handler that
// returns nothing leaves the payload alone.
// What a handler may return, per event. Most return nothing; the ones that can
// change what happens say so in their own type rather than every handler
// sharing one loose `string | false`.
export type Verdict = {
  input: string | false;
  tool_call: string | false;
  tool_end: string;
  before_request: string;
  context: readonly ModelMessage[];
  before_provider_request: { headers?: Record<string, string>; body?: unknown };
};

export type HandlerVerdict<E extends EventName = EventName> =
  | undefined
  | (E extends keyof Verdict ? Verdict[E] : never);

export type Handler<E extends EventName> = (
  payload: EventPayload[E],
) => HandlerVerdict<E> | Promise<HandlerVerdict<E>>;

export type ToolSpec<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: Schema;
  execute: (input: z.infer<Schema>, signal: AbortSignal | undefined) => string | Promise<string>;
  // How the row looks while the call runs, and once it has finished. Omit
  // either and glrs draws its usual row.
  renderCall?: (input: z.infer<Schema>) => Line[];
  renderResult?: (result: string, ok: boolean) => Line[];
};

export type CommandSpec = {
  description: string;
  run: (args: string) => void | Promise<void>;
};

// What is loaded right now. Every listing glrs used to ship as a built-in
// command is a view over this and nothing more, which is why none of them are
// built in any longer.
export type Loaded = {
  commands: ReadonlyArray<{ name: string; description: string; origin?: string }>;
  // The real type, not a copy of its fields — a second declaration of the same
  // shape is a second thing to remember to update, and this one had already
  // fallen behind.
  skills: readonly SkillSummary[];
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

/** A keypress, in glrs's own vocabulary rather than the renderer's. */
export type Key = {
  /** "return", "escape", "up", "backspace", "a" … */
  key: string;
  ctrl: boolean;
  shift: boolean;
  /** The printable text this key produced. Empty for control keys. */
  text: string;
};

export type Capture = {
  /** Draw the composer area. Called on every key, and on resize. */
  render: (columns: number) => Line[];
  /** Every keypress, until you close. Nothing else sees them. */
  onKey: (key: Key) => void;
};

export type Ui = {
  /**
   * Take over the composer area: draw your own lines there and receive every
   * key, until you call close().
   *
   * This is the whole of glrs's input primitive, and it is deliberately the
   * only one. There was an `ask`, a `select`, a `confirm` and an `input` here,
   * which meant the core had an opinion about what a question looks like — a
   * 234-line widget lived in the renderer for the sake of one tool, and the
   * "generic" helpers around it were parsing the JSON that tool returned to the
   * model. A coding agent's core does not need to know what asking is.
   *
   * The bundled `ask-user` extension is a question widget written against
   * nothing but this. A picker, a form, a diff viewer are the same amount of
   * work, and none of them is privileged over yours.
   */
  capture: (spec: Capture) => { close: () => void; repaint: () => void };
  /** Put text in the composer, ready to edit. */
  setInput: (text: string) => void;
};

export type Glrs = {
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
  /** Register a CLI flag: `glrs --name value`. */
  flag: (name: string, spec: FlagSpec) => void;
  /** Subscribe to a lifecycle event. */
  on: <E extends EventName>(event: E, handler: Handler<E>) => void;
  /** Run a shell command in the project root. */
  exec: (command: string, args?: readonly string[]) => Promise<ShellResult>;
  /**
   * Start a turn. `label` is what the transcript shows instead of the text.
   * `steer` joins the turn already running, at its next step boundary, so the
   * model reads it before it chooses its next action; without it the message
   * waits until the agent has finished all its work. With nothing running the
   * two are the same thing — a turn.
   */
  send: (text: string, options?: { label?: string; steer?: boolean }) => void;
  /** Write into the transcript. Pass Line[] when you want it styled. */
  print: (content: string | Line[], tone?: Tone) => void;
  /** Terminal width. Anything wider than this wraps, so measure before drawing. */
  columns: () => number;
  /** Clip to a width, counting what the terminal counts: graphemes, not chars. */
  clip: (text: string, limit: number) => string;
  /**
   * What this session considers in scope beyond the project root: `write` is
   * your agent directories, `read` is those plus glrs's own documentation,
   * which the system prompt hands the model an absolute path to. A tool that
   * confines paths widens to these. Nothing here enforces anything for you —
   * the built-in tools are an extension too, and this is what they read.
   */
  scope: () => Scope;
  /**
   * This session's resolved settings, merged from every config file that
   * applied. Provider blocks are absent: they hold API keys, and an extension
   * that wants them can read the files itself rather than be handed them.
   */
  settings: () => Readonly<Settings>;
  /** What is loaded: commands, skills, extensions. */
  inspect: () => Loaded;
  /** Drop the conversation the model replays. The transcript is untouched. */
  clear: () => "cleared" | "busy" | "empty";
  /**
   * Summarise the older part of the conversation and carry the brief forward,
   * so a session can outlive its context window. `keep` is roughly how many
   * tokens of recent turns to leave verbatim.
   */
  compact: (options?: { instruction?: string; keep?: number }) => Promise<Compaction>;
  /** Re-read skills, commands, and extensions from disk. */
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
   * Narrow what the model can call, from the next turn onward. Return false for
   * a tool to withhold it. Withholding beats instructing: a tool that is absent
   * cannot be talked into being used.
   *
   * Every extension's filter has to agree, so restrictions compose and can only
   * narrow. This replaced a `setTools(names)` that set one global list — a
   * read-only extension and a no-network extension would each call it, the
   * second would silently undo the first, and neither could see the other.
   *
   * Returns a handle that lifts your own filter and nobody else's.
   */
  filterTools: (keep: (name: string) => boolean) => { lift: () => void };

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
  /** Quit glrs. */
  shutdown: () => void;

  /** This session: id, file on disk, title, event count. */
  session: () => SessionInfo;
  /** Rename the session, as the resume picker shows it. */
  setSessionName: (title: string) => void;
  /** Persist your own data in the session file. Never sent to the model. */
  appendEntry: (type: string, data: unknown) => void;
  /**
   * Everything this session has recorded under `type`, oldest first — including
   * entries written before a `--resume`, since a resumed session replays them.
   *
   * appendEntry had no counterpart, so an extension could write to the session
   * file and never read it back: storage you cannot read is not storage, and
   * the only way to recover your own data was to open `session().file` and
   * parse it yourself.
   */
  entries: (type: string) => readonly unknown[];

  /** Transform assistant markdown before it is rendered. Display only. */
  markdown: (transform: (text: string) => string) => void;
  /** A bus for extensions to talk to each other. */
  events: {
    emit: (name: string, payload?: unknown) => void;
    on: (name: string, handler: (payload: unknown) => void) => void;
  };
  /** Append a line to the per-turn preamble the model reads. */
  prompt: (text: string) => void;
  /** Contribute a segment to the status line. Return null to show nothing. */
  status: (render: () => string | null) => void;
  /** Draw extra rows above the status line. Return [] to show nothing. */
  footer: (render: () => Line[]) => void;
  /**
   * Replace the activity row — what the turn is doing, how long it has been
   * doing it, and how to stop it. Return null to leave glrs's own. The
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
  columns: () => number;
  capture: (spec: Capture) => { close: () => void; repaint: () => void };
  setInput: (text: string) => void;
  scope: () => Scope;
  settings: () => Readonly<Settings>;
  inspect: () => Loaded;
  clear: () => "cleared" | "busy" | "empty";
  compact: (options?: { instruction?: string; keep?: number }) => Promise<Compaction>;
  reload: () => Promise<void>;
  tools: () => readonly string[];
  setToolFilters: (filters: ReadonlyArray<(name: string) => boolean>) => void;
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
  entries: (type: string) => readonly unknown[];
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
  // Every extension's tool filter. All of them must agree for a tool to survive.
  toolFilters: Array<(name: string) => boolean>;
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
  contributions: Map<
    string,
    { tools: string[]; shadowed: string[]; commands: string[]; hooks: number; ui: number }
  >;
};

// Empty every container in place. A reload replaces what extensions
// contributed without replacing the registry itself — index.ts and the agent
// both hold this object by reference, and swapping it would leave them looking
// at the old one.
export const resetRegistry = (registry: Registry): void => {
  for (const name of Object.keys(registry.tools)) delete registry.tools[name];
  registry.commands.length = 0;
  registry.toolFilters.length = 0;
  registry.statuses.length = 0;
  registry.footers.length = 0;
  registry.activities.length = 0;
  registry.promptLines.length = 0;
  registry.keys.length = 0;
  registry.markdown.length = 0;
  registry.runners.clear();
  registry.handlers.clear();
  registry.renderers.clear();
  registry.flags.clear();
  registry.bus.clear();
  registry.contributions.clear();
};

export const createRegistry = (): Registry => ({
  tools: {},
  commands: [],
  runners: new Map(),
  handlers: new Map(),
  renderers: new Map(),
  toolFilters: [],
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
    entry.shadowed.length > 0 && `shadowed: ${entry.shadowed.join(", ")}`,
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
): Glrs => {
  const ledger = {
    tools: [] as string[],
    shadowed: [] as string[],
    commands: [] as string[],
    hooks: 0,
    ui: 0,
  };
  registry.contributions.set(origin, ledger);
  return {
    root: host.root,
    scope: () => host.scope(),
    settings: () => host.settings(),
    z,
    // First to claim a name keeps it, which is the rule every other namespace
    // here already follows — commands, user commands, skills, and the activity
    // row. Tool names were the one exception, and the exception ran backwards:
    // the later an extension loaded, the more it could take. Since the loader
    // walks the project before anything shipped, first-wins is what makes a
    // project extension able to replace a tool glrs ships.
    //
    // The loser is recorded rather than dropped silently: /extensions is the
    // only account anyone gets of what an extension did, and listing a tool it
    // does not own would make that account wrong.
    tool: (spec) => {
      if (Object.hasOwn(registry.tools, spec.name)) {
        ledger.shadowed.push(spec.name);
        return;
      }
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
      // The registry stores handlers for every event together; each one is
      // typed to its own event, which no single element type can express.
      bucket.push(handler as unknown as Handler<EventName>);
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
    columns: host.columns,
    clip,
    inspect: host.inspect,
    clear: host.clear,
    compact: host.compact,
    reload: host.reload,
    prompt: (text) => registry.promptLines.push(text),
    mode: host.mode,
    hasUI: host.mode === "tui",
    ui: {
      capture: host.capture,
      setInput: host.setInput,
    },
    tools: host.tools,
    filterTools: (keep) => {
      registry.toolFilters.push(keep);
      host.setToolFilters(registry.toolFilters);
      return {
        lift: () => {
          const at = registry.toolFilters.indexOf(keep);
          if (at < 0) return;
          registry.toolFilters.splice(at, 1);
          host.setToolFilters(registry.toolFilters);
        },
      };
    },
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
    entries: host.entries,
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
): Promise<HandlerVerdict<E>> => {
  let replaced: HandlerVerdict<E>;
  for (const handler of registry.handlers.get(event) ?? []) {
    try {
      const said = await (handler as unknown as Handler<E>)(payload);
      // `false` is a refusal and ends the matter — no later handler can undo
      // another's block.
      if (said === false) return said as HandlerVerdict<E>;
      if (said !== undefined) replaced = said as HandlerVerdict<E>;
    } catch (thrown) {
      onFailure(`${event} handler failed: ${thrown instanceof Error ? thrown.message : thrown}`);
    }
  }
  return replaced;
};
