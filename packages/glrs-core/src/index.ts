import type { ModelMessage } from "ai";
import type { z } from "zod";
import type { SessionEvent } from "./events";
import type { Session } from "./session";

export type { ModelMessage } from "ai";
export * from "./events";
export * from "./session";

// The renderer supports seven; this said five, so `prompt` and `success` were
// tones an extension could not name without a type error even though every
// host would draw them.
export type Tone = "accent" | "highlight" | "muted" | "prompt" | "success" | "warning" | "danger";
// `italic` and `underline` are honoured by the renderer (chrome.ts) and were
// missing here, so an extension could not ask for them.
export type Span = {
  text: string;
  tone?: Tone;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fill?: boolean;
};
export type Line = Span[];

export type ToolCall = {
  id: string | number;
  name: string;
  input: Record<string, unknown>;
};

export type ModelStep = {
  id: string | number;
  messages: readonly ModelMessage[];
  toolCalls: readonly ToolCall[];
};

export type Turn = {
  id: string;
  input: string;
  steps: readonly ModelStep[];
  events: readonly SessionEvent[];
  status: "running" | "settled" | "failed" | "aborted";
};

export type ToolSpec<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: Schema;
  execute: (
    input: z.infer<Schema>,
    signal: AbortSignal | undefined,
  ) =>
    | string
    | { content: string; data?: unknown }
    | Promise<string | { content: string; data?: unknown }>;
  /** End the active turn after this tool result is delivered to the model. */
  terminate?: boolean;
  renderCall?: (input: z.infer<Schema>) => Line[];
  renderResult?: (result: string, ok: boolean) => Line[];
};

export type Key = { key: string; ctrl: boolean; shift: boolean; text: string };
export type Capture = {
  render: (columns: number) => Line[];
  onKey: (key: Key) => void;
};

export type SurfacePlacement =
  | "editor"
  | "above-editor"
  | "below-editor"
  | "header"
  | "footer"
  | "overlay";

export type MountSpec = Capture & {
  placement: SurfacePlacement;
  overlay?: {
    width?: number | `${number}%`;
    height?: number | `${number}%`;
    row?: number;
    column?: number;
    modal?: boolean;
  };
};

export type AutocompleteItem = { name: string; description: string };
export type AutocompleteProvider = {
  sigil: string;
  complete: (query: string) => readonly AutocompleteItem[] | Promise<readonly AutocompleteItem[]>;
};

export type CommandSpec = {
  description: string;
  run: (args: string) => void | Promise<void>;
};

// UiHost was here: a second, optional-everything description of the same
// surface, referenced by nothing. It declared `print`, `ask`, `status`,
// `footer` and `activity`, none of which any host implements — `ask` was
// residue of a removed widget — and omitted `setInput`, which all three do.
// Optional members meant `g.ui.status?.(…)` typechecked and was undefined at
// runtime. `Ui` below is the type of the object that is actually built.

export type SkillSummary = {
  name: string;
  command: string;
  description: string;
  location: string;
  modelInvocable: boolean;
  // Parsed from frontmatter and, until now, unreachable: `license` and
  // `metadata` never left the private Skill type, and `compatibility` reached
  // the summary with no reader. A field a skill author can set and nobody can
  // read is a field that does not exist.
  compatibility: string;
  license: string;
  metadata: Readonly<Record<string, string>>;
  allowedTools: readonly string[];
};

export type LoadedExtension = { name: string; origin: string; contributed: string };
export type Compaction =
  | { outcome: "compacted"; dropped: number; kept: number }
  | { outcome: "too-short" | "busy" }
  | { outcome: "failed"; error: string };
export type Usage = {
  tokens: number | null;
  context?: number;
  total: { input: number; output: number; cached: number; cost: number; steps: number };
};

// This session's resolved runtime settings, merged from every config file that
// applied. Provider connection settings are deliberately outside this compact
// view; an extension that needs them can read config itself.
export type Settings = {
  toolTimeoutMs?: number;
  reasoningDisplay?: boolean | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  steeringMode?: "one-at-a-time" | "all";
  followUpMode?: "one-at-a-time" | "all";
};

export type EventPayload = {
  session_start: { root: string };
  // The session is tearing down. Awaited, so an extension gets to finish.
  session_end: { root: string };
  // Returning a string replaces what the user typed; returning false swallows
  // it, which is how an extension handles input itself.
  input: { text: string };
  user_bash: { command: string };
  before_agent_start: { prompt: string; systemPrompt: string };
  agent_start: { prompt: string };
  agent_end: { text: string };
  session_before_compact: { automatic: boolean; instruction?: string };
  session_before_switch: { from: string; to: string };
  session_before_fork: { id: string; at?: number };
  session_shutdown: { root: string };
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
  input: string | false | { text: string; streamingBehavior?: "steer" | "follow-up" };
  user_bash: { command: string } | false;
  before_agent_start: string | false | { prompt?: string; systemPrompt?: string };
  session_before_compact: { summary?: string; instruction?: string } | false;
  session_before_switch: false;
  session_before_fork: false;
  tool_call: string | false;
  tool_end: string;
  before_request: string;
  context: readonly ModelMessage[];
  before_provider_request: { headers?: Record<string, string>; body?: unknown };
};

export type HandlerVerdict<E extends EventName = EventName> =
  | undefined
  | (E extends keyof Verdict ? Verdict[E] : never);

// Which first-party extension is on, off, or has never been decided. The
// three states fall out of the two config lists rather than needing a store of
// their own: named in `load` is a yes, named in `disable` is a no, and in
// neither is a question nobody has answered.
export type FirstPartyExtension = {
  name: string;
  summary: string;
  state: "on" | "off";
};

export type WriteOutcome = "written" | "not-allowed" | "already" | "failed";

// What the model is doing and for how long, plus how to stop it. This used to
// be that text pinned to the right of a full-width animated sine field; the
// field carried no information and cost a repaint on every one of eleven frames
// a second. The phase leads because it is the part that changes, so a narrow
// terminal clips the fixed hint rather than the live reading.
// What the turn is doing, and how to stop it. The state an extension replacing
// this row is handed.
export type Activity = {
  busy: boolean;
  queued: number;
  columns: number;
  phase?: { name: string; ms: number } | null;
};

// How a queue hands its messages over: one per opportunity, or all of them at
// once. Declared here because both the coding agent (which runs the queues) and
// glrs-providers (which validates the setting) need it, and neither may
// import the other — the same reason the extension API lives here. It was
// declared in both, with glrs-providers keeping a private copy of the list
// and the predicate beside it.
export type QueueMode = "one-at-a-time" | "all";
export const QUEUE_MODES: readonly QueueMode[] = ["one-at-a-time", "all"];
export const isQueueMode = (value: unknown): value is QueueMode =>
  typeof value === "string" && QUEUE_MODES.includes(value as QueueMode);

// The extension API, declared once.
//
// This was two types: the real one on the object `extension-api.ts` builds, and
// a hand-maintained copy here that extensions imported. They drifted — the copy
// carried 26 members while the object carried 44, so `model`, `tools`, `status`,
// `footer`, `key`, `flag`, `abort`, `setModel` and ten more existed at runtime
// and were invisible to anyone writing an extension against the type.
//
// It lives here because `packages/extensions` may not import the coding agent
// (see scripts/check-boundaries.ts), which is what forced the copy in the first
// place. The agent implements this type rather than declaring its own, so the
// two cannot drift again without failing to compile.

// One definition, in ./shell, where both the coding agent and the tools
// extension can reach it. Two copies of one shape is two things to remember to
// change, and the last pair had already drifted.
import type { ShellResult } from "./shell";

export type { ShellResult };

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
  /** Mount a custom editor, widget, header, footer, or overlay. */
  mount: (spec: MountSpec) => { close: () => void; repaint: () => void };
  /** Show a transient or transcript-backed notification. */
  notify: (message: string, tone?: Tone) => void;
  /** Override theme colors until the returned handle restores them. */
  setTheme: (theme: Partial<Record<Tone, string>>) => { restore: () => void };
  /** Put text in the composer, ready to edit. */
  setInput: (text: string) => void;
};

export type EventName =
  | "session_start"
  | "session_end"
  | "input"
  | "user_bash"
  | "before_agent_start"
  | "agent_start"
  | "agent_end"
  | "session_before_compact"
  | "session_before_switch"
  | "session_before_fork"
  | "session_shutdown"
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

export type Handler<E extends EventName> = (
  payload: EventPayload[E],
) => HandlerVerdict<E> | Promise<HandlerVerdict<E>>;

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

// A subcommand of the `glrs` executable, contributed by an extension. It runs
// outside any session — no model, no transcript, no screen — so what reaches it
// is git, the filesystem and stdout. That is what `glrs wt list` needs and all
// it needs; anything wanting the model belongs in a slash command or a tool.
export type CliSpec = {
  /** One line, shown by `glrs --help` under the extension that added it. */
  description: string;
  /**
   * Everything after the subcommand name, already split. Throw to exit
   * non-zero — the message goes to stderr, the same way every other failure in
   * glrs surfaces.
   */
  run: (args: readonly string[]) => void | Promise<void>;
};

export type ExtensionProvider = {
  id: string;
  create: (
    modelId: string,
    options?: Record<string, unknown>,
  ) => Extract<import("ai").LanguageModel, { specificationVersion: "v4" }>;
};

export type MessageRenderer = (event: SessionEvent) => Line[] | undefined;
export type EntryRenderer = (data: unknown) => Line[] | undefined;

export type ModelInfo = {
  label: string;
  provider: string;
  modelId: string;
  variant?: string;
  variants?: readonly string[];
  context?: number;
  /**
   * What glrs cannot find before this provider can answer: environment variable
   * names, or a config key. Empty means it found everything it knows to look
   * for, which is not the same as a call that will succeed. An AWS profile on
   * disk, Vertex application default credentials and a provider an extension
   * registers are all reachable and all report nothing here.
   *
   * Optional so that a later field on this type is an addition rather than a
   * break: an extension building its own catalogue entries, as the model picker
   * does, would otherwise have to be changed every time glrs learns something
   * new about a model. Absent and empty mean the same thing to a reader.
   */
  missing?: readonly string[];
};

export type SessionInfo = {
  id: string;
  file: string;
  title: string;
  events: number;
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
  // What extensions bound, so `/help` can list it rather than restate it.
  // `KeySpec.description` and `FlagSpec.description` were required at
  // registration and read by nothing: help printed a hardcoded table, and
  // `describeContribution` could not so much as mention a flag.
  keys: ReadonlyArray<{ key: string; ctrl?: boolean; shift?: boolean; description: string }>;
  flags: ReadonlyArray<{ name: string; description: string }>;
};

// What recording a choice about a first-party extension can come back as.
export type ExtensionChoice = WriteOutcome | "unknown";

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
  /**
   * Add a subcommand to the `glrs` executable: `g.cli("wt", …)` makes
   * `glrs wt …` work. It runs without a session, so `g.print` writes to stdout
   * and the members needing a model or a screen throw rather than pretend.
   */
  cli: (name: string, spec: CliSpec) => void;
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
   * Keep the tail of a long value and mark the omitted head.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  truncateHead: (text: string, limit: number) => string;
  /**
   * This session's resolved settings, merged from every config file that
   * applied. Provider blocks are absent: they hold API keys, and an extension
   * that wants them can read the files itself rather than be handed them.
   */
  settings: () => Readonly<Settings>;
  /**
   * First-party extensions, and whether each is on, off, or has never been
   * decided. The three states come from config: named in `extensions.load`,
   * named in `extensions.disable`, or in neither.
   */
  available: () => readonly FirstPartyExtension[];
  /**
   * Record that one should or should not load, by writing `extensions.load` or
   * `extensions.disable` in the project's config. Returns `"not-allowed"` unless
   * `agentConfigAllowlist` names `"extensions"` — config is hand-edited unless
   * you have said otherwise.
   */
  setExtension: (name: string, on: boolean) => Promise<ExtensionChoice>;
  /**
   * This extension's own config, from `extensions.settings.<name>` in any of
   * the three scopes, merged. `undefined` when nothing configured it. glrs
   * never looks inside, so the shape is yours to define and yours to validate.
   *
   * ```ts
   * const settings = g.config() as { greeting?: string } | undefined;
   * g.print(settings?.greeting ?? "hello");
   * ```
   */
  config: () => unknown;

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
  // "cli" is a subcommand run: no session, no model, no screen.
  mode: "tui" | "print" | "cli";
  /** False outside the TUI: nothing can be asked and nothing can be drawn. */
  hasUI: boolean;
  /** Prompts, pickers and the composer. Throws in print mode. */
  ui: Ui;

  /** Add completions for a sigil such as `#`. */
  autocomplete: (provider: AutocompleteProvider) => { dispose: () => void };
  /** Register a model provider, including providers with their own OAuth flow. */
  provider: (provider: ExtensionProvider) => { dispose: () => void };
  /**
   * Render durable transcript messages before the default renderer.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  messageRenderer: (renderer: MessageRenderer) => void;
  /**
   * Render one kind of extension-owned session entry.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  entryRenderer: (type: string, renderer: EntryRenderer) => void;

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
  /** The active model, or null when nothing has been chosen yet. */
  model: () => ModelInfo | null;
  /** Every model the catalogue knows, each carrying what its provider is missing. */
  models: () => Promise<readonly ModelInfo[]>;
  /** Switch model, as "provider/model-id". Takes effect on the next turn. */
  setModel: (label: string, variant?: string) => Promise<void>;
  /**
   * Write the active model and variant into the project's config, so the next
   * session starts on it. Returns `"not-allowed"` unless `agentConfigAllowlist`
   * names `"model"`, or when no model has been chosen and there is nothing to
   * record; `"already"` when the file already says this. Separate from
   * `setModel` on purpose: switching for one turn and choosing for good are
   * different acts, and only the second is worth writing to disk.
   */
  rememberModel: () => Promise<WriteOutcome>;
  /** Change reasoning effort without changing the active model. */
  setThinkingLevel: (level: string) => Promise<void>;

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

  /**
   * Messages currently carried into the next model call.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  history: () => readonly ModelMessage[];
  /**
   * Fork this session after lifecycle gates approve it.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  forkSession: (at?: number) => Promise<SessionInfo>;
  /**
   * Switch the active session after lifecycle gates approve it.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  switchSession: (id: string) => Promise<boolean>;
  /**
   * Label an event for tree/bookmark UIs.
   *
   * @beta Not covered by the 1.0.0 stability promise: may change in a minor.
   */
  setLabel: (event: number, label: string) => void;
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
  /**
   * Contribute a line to the per-turn preamble. Pass a function to have it
   * rendered fresh each turn — that is how a contribution reflects something
   * that happened during the session rather than only what was true at load.
   * Return "" to say nothing this turn.
   */
  prompt: (text: string | (() => string)) => void;
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

export type ExtensionContext = Glrs;
export type Extension = (context: Glrs) => void | Promise<void>;

/** Provider adapter capable of constructing one model. */
export type ModelProvider = {
  id: string;
  model: (modelId: string, options?: Record<string, unknown>) => unknown;
};

/** Minimal provider-neutral agent runtime used by SDK hosts. */
export type AgentCore = {
  session: Session;
  runTurn: (input: string) => Promise<Turn>;
  reloadExtensions: () => Promise<void>;
};

export type AgentCoreOptions = AgentCore;

/** Create an agent core from host-supplied turn and extension behavior. */
export const createAgentCore = (options: AgentCoreOptions): AgentCore => ({
  session: options.session,
  runTurn: options.runTurn,
  reloadExtensions: options.reloadExtensions,
});

export * from "./display";
export type { Extension as ExtensionFactory };
