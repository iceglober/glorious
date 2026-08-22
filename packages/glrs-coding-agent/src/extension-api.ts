import type { ToolSet } from "ai";
import { z } from "zod";
import type { Settings } from "../../glrs-core/src";
import { truncateHead } from "../../glrs-core/src/shell";
import type { Compaction } from "./chat";
import type { Command } from "./commands";
import type { FirstPartyExtension } from "./extensions";
import { clip, type Line, type Tone } from "./render";
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

// Declared in glrs-core, because `packages/extensions` may not import this
// package. Re-exported so everything in the agent keeps importing them from
// here, while there is only one declaration of each.
import type {
  AutocompleteProvider,
  CliSpec,
  EntryRenderer,
  EventName,
  EventPayload,
  ExtensionChoice,
  ExtensionProvider,
  FlagSpec,
  Glrs,
  Handler,
  HandlerVerdict,
  KeySpec,
  Loaded,
  MessageRenderer,
  ModelInfo,
  MountSpec,
  ProviderConnectionResult,
  ProviderInfo,
  SessionInfo,
  ShellResult,
  SurfacePlacement,
  Ui,
  Verdict,
  WriteOutcome,
} from "../../glrs-core/src";
import type { Activity } from "./render";

export type {
  AutocompleteProvider,
  CliSpec,
  EntryRenderer,
  EventName,
  EventPayload,
  ExtensionChoice,
  ExtensionProvider,
  FlagSpec,
  Glrs,
  Handler,
  HandlerVerdict,
  KeySpec,
  Loaded,
  MessageRenderer,
  ModelInfo,
  MountSpec,
  ProviderConnectionResult,
  ProviderInfo,
  SessionInfo,
  ShellResult,
  SurfacePlacement,
  Ui,
  Verdict,
  WriteOutcome,
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
  terminate?: boolean;
  // How the row looks while the call runs, and once it has finished. Omit
  // either and glrs draws its usual row.
  renderCall?: (input: z.infer<Schema>) => Line[];
  renderResult?: (result: string, ok: boolean) => Line[];
};

export type CommandSpec = {
  description: string;
  run: (args: string) => void | Promise<void>;
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

// What index.ts hands the API so it can reach the running session. Split out so
// the facade has no idea whether it is talking to a TUI or a print run.
export type ExtensionHost = {
  root: string;
  mode: "tui" | "print" | "cli";
  exec: (command: string, args?: readonly string[]) => Promise<ShellResult>;
  send: (text: string, options: { label?: string; steer?: boolean }) => void;
  print: (content: string | Line[], tone: Tone) => void;
  columns: () => number;
  capture: (spec: Capture) => { close: () => void; repaint: () => void };
  mount: (spec: MountSpec) => { close: () => void; repaint: () => void };
  notify: (message: string, tone?: Tone) => void;
  setTheme: (theme: Partial<Record<Tone, string>>) => { restore: () => void };
  autocomplete: (provider: AutocompleteProvider) => { dispose: () => void };
  setInput: (text: string) => void;
  settings: () => Readonly<Settings>;
  available: () => readonly FirstPartyExtension[];
  setExtension: (name: string, on: boolean) => Promise<ExtensionChoice>;
  inspect: () => Loaded;
  clear: () => "cleared" | "busy" | "empty";
  compact: (options?: { instruction?: string; keep?: number }) => Promise<Compaction>;
  reload: () => Promise<void>;
  tools: () => readonly string[];
  setToolFilters: (filters: ReadonlyArray<(name: string) => boolean>) => void;
  model: () => ModelInfo | null;
  models: () => Promise<readonly ModelInfo[]>;
  providers: () => Promise<readonly ProviderInfo[]>;
  connectProvider: (
    provider: string,
    apiKey?: string,
    settings?: Readonly<Record<string, string>>,
  ) => Promise<ProviderConnectionResult>;
  setModel: (label: string, variant?: string) => Promise<void>;
  rememberModel: () => Promise<WriteOutcome>;
  registerProvider: (provider: ExtensionProvider) => { dispose: () => void };
  history: () => readonly import("ai").ModelMessage[];
  forkSession: (at?: number) => Promise<SessionInfo>;
  switchSession: (id: string) => Promise<boolean>;
  setLabel: (event: number, label: string) => void;
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
  // Subcommands of the executable. First claim kept, like tools.
  cli: Map<string, CliSpec & { origin: string }>;
  handlers: Map<EventName, Array<Handler<EventName>>>;
  renderers: Map<string, ToolRenderer>;
  terminatingTools: Set<string>;
  messageRenderers: MessageRenderer[];
  entryRenderers: Map<string, EntryRenderer>;
  providerRegistrations: Array<{ dispose: () => void }>;
  uiDisposables: Array<() => void>;
  // Every extension's tool filter. All of them must agree for a tool to survive.
  toolFilters: Array<(name: string) => boolean>;
  statuses: Array<() => string | null>;
  footers: Array<() => Line[]>;
  activities: Array<(state: Activity) => Line[] | null>;
  // A string was decided at registration; a function is asked each turn.
  promptLines: Array<string | (() => string)>;
  keys: KeySpec[];
  flags: Map<string, FlagSpec>;
  markdown: Array<(text: string) => string>;
  bus: Map<string, Array<(payload: unknown) => void>>;
  // What each extension registered, keyed by its file. /extensions reads this,
  // and it is the only account anyone gets of what a loaded extension did —
  // there being no approval prompt to have read it out beforehand.
  contributions: Map<
    string,
    {
      tools: string[];
      shadowed: string[];
      commands: string[];
      cli: string[];
      hooks: number;
      ui: number;
    }
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
  registry.cli.clear();
  registry.handlers.clear();
  registry.renderers.clear();
  registry.terminatingTools.clear();
  registry.messageRenderers.length = 0;
  registry.entryRenderers.clear();
  for (const registration of registry.providerRegistrations) registration.dispose();
  registry.providerRegistrations.length = 0;
  for (const dispose of registry.uiDisposables) dispose();
  registry.uiDisposables.length = 0;
  registry.flags.clear();
  registry.bus.clear();
  registry.contributions.clear();
};

export const createRegistry = (): Registry => ({
  tools: {},
  commands: [],
  runners: new Map(),
  cli: new Map(),
  handlers: new Map(),
  renderers: new Map(),
  terminatingTools: new Set(),
  messageRenderers: [],
  entryRenderers: new Map(),
  providerRegistrations: [],
  uiDisposables: [],
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

// What the per-turn preamble actually says, resolved from what extensions
// contributed. A function is asked fresh each turn, so a contribution can
// reflect the session rather than only what was true at load; one that throws
// loses its own line rather than the turn, and one that returns "" says nothing.
//
// Shared by both hosts on purpose. This is the third thing index.ts and print.ts
// each have to do identically, and the previous two drifted.
export const promptContributions = (lines: ReadonlyArray<string | (() => string)>): string[] =>
  lines.flatMap((line) => {
    if (typeof line === "string") return line === "" ? [] : [line];
    try {
      const said = line();
      return said === "" ? [] : [said];
    } catch {
      return [];
    }
  });

export const describeContribution = (registry: Registry, origin: string): string => {
  const entry = registry.contributions.get(origin);
  if (!entry) return "registered nothing";
  const parts = [
    entry.tools.length > 0 && `tools: ${entry.tools.join(", ")}`,
    entry.shadowed.length > 0 && `shadowed: ${entry.shadowed.join(", ")}`,
    entry.commands.length > 0 && `commands: ${entry.commands.map((n) => `/${n}`).join(", ")}`,
    entry.cli.length > 0 && `cli: ${entry.cli.map((n) => `glrs ${n}`).join(", ")}`,
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
    cli: [] as string[],
    hooks: 0,
    ui: 0,
  };
  registry.contributions.set(origin, ledger);
  return {
    root: host.root,
    settings: () => host.settings(),
    available: () => host.available(),
    setExtension: (name, on) => host.setExtension(name, on),
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
        async (input, signal) => {
          const result = await spec.execute(input, signal);
          return typeof result === "string" ? result : result.content;
        },
      );
      if (spec.terminate) registry.terminatingTools.add(spec.name);
      if (spec.renderCall || spec.renderResult)
        registry.renderers.set(spec.name, {
          call: spec.renderCall as ToolRenderer["call"],
          result: spec.renderResult,
        });
    },
    // First claim kept, like tools: two extensions offering `glrs wt` should not
    // depend on load order, and the project is walked before anything shipped.
    cli: (name, spec) => {
      const slug = name.toLowerCase();
      if (registry.cli.has(slug)) {
        ledger.shadowed.push(`${slug} (cli)`);
        return;
      }
      ledger.cli.push(slug);
      registry.cli.set(slug, { ...spec, origin });
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
    truncateHead,
    inspect: host.inspect,
    clear: host.clear,
    compact: host.compact,
    reload: host.reload,
    prompt: (text) => {
      registry.promptLines.push(text);
    },
    mode: host.mode,
    hasUI: host.mode === "tui",
    ui: {
      capture: (spec) => {
        const handle = host.capture(spec);
        registry.uiDisposables.push(handle.close);
        return handle;
      },
      mount: (spec) => {
        const handle = host.mount(spec);
        registry.uiDisposables.push(handle.close);
        return handle;
      },
      notify: host.notify,
      setTheme: (theme) => {
        const handle = host.setTheme(theme);
        registry.uiDisposables.push(handle.restore);
        return handle;
      },
      setInput: host.setInput,
    },
    autocomplete: (provider) => {
      const handle = host.autocomplete(provider);
      registry.uiDisposables.push(handle.dispose);
      return handle;
    },
    provider: (provider) => {
      const registration = host.registerProvider(provider);
      registry.providerRegistrations.push(registration);
      return registration;
    },
    messageRenderer: (renderer) => registry.messageRenderers.push(renderer),
    entryRenderer: (type, renderer) => registry.entryRenderers.set(type, renderer),
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
    providers: host.providers,
    connectProvider: host.connectProvider,
    setModel: host.setModel,
    rememberModel: host.rememberModel,
    setThinkingLevel: async (level) => {
      const current = host.model();
      if (current === null)
        throw new Error("No model is selected, so there is no reasoning effort to change.");
      await host.setModel(current.label, level);
    },
    history: host.history,
    forkSession: host.forkSession,
    switchSession: host.switchSession,
    setLabel: host.setLabel,
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
