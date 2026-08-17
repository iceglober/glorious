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

export type { Line, Span, Tone } from "./render";

export type ShellResult = { output: string; stdout: string; ok: boolean };

export type EventName =
  | "session_start"
  | "input"
  | "turn_start"
  | "turn_end"
  | "tool_start"
  | "tool_end";

export type EventPayload = {
  session_start: { root: string };
  // Returning a string replaces what the user typed; returning false swallows
  // it, which is how an extension handles input itself.
  input: { text: string };
  turn_start: { text: string };
  turn_end: { text: string };
  tool_start: { name: string; input: Record<string, unknown> };
  tool_end: { name: string; input: Record<string, unknown>; ok: boolean; result: string };
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
  /** Subscribe to a lifecycle event. */
  on: <E extends EventName>(event: E, handler: Handler<E>) => void;
  /** Run a shell command in the project root. */
  exec: (command: string, args?: readonly string[]) => Promise<ShellResult>;
  /** Start a turn. `label` is what the transcript shows instead of the text. */
  send: (text: string, label?: string) => void;
  /** Write into the transcript. Pass Line[] when you want it styled. */
  print: (content: string | Line[], tone?: Tone) => void;
  /** What is loaded: commands, sequences, skills, extensions. */
  inspect: () => Loaded;
  /** Drop the conversation the model replays. The transcript is untouched. */
  clear: () => "cleared" | "busy" | "empty";
  /** Re-read skills, commands and sequences from disk. */
  reload: () => Promise<void>;
  /** Ask the user, using the same widget the ask_user tool uses. */
  ask: (questions: Question[]) => Promise<string>;
  /** Append a line to the per-turn preamble the model reads. */
  prompt: (text: string) => void;
  /** Contribute a segment to the status line. Return null to show nothing. */
  status: (render: () => string | null) => void;
  /** Draw extra rows above the status line. Return [] to show nothing. */
  footer: (render: () => Line[]) => void;
};

// What index.ts hands the API so it can reach the running session. Split out so
// the facade has no idea whether it is talking to a TUI or a print run.
export type ExtensionHost = {
  root: string;
  exec: (command: string, args?: readonly string[]) => Promise<ShellResult>;
  send: (text: string, label: string | null) => void;
  print: (content: string | Line[], tone: Tone) => void;
  ask: (questions: Question[]) => Promise<string>;
  inspect: () => Loaded;
  clear: () => "cleared" | "busy" | "empty";
  reload: () => Promise<void>;
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
  promptLines: string[];
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
  promptLines: [],
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
    exec: host.exec,
    send: (text, label) => host.send(text, label ?? null),
    print: (content, tone = "muted") => host.print(content, tone),
    ask: host.ask,
    inspect: host.inspect,
    clear: host.clear,
    reload: host.reload,
    prompt: (text) => registry.promptLines.push(text),
    status: (render) => {
      ledger.ui += 1;
      registry.statuses.push(render);
    },
    footer: (render) => {
      ledger.ui += 1;
      registry.footers.push(render);
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
