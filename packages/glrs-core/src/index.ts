import type { ModelMessage } from "ai";
import type { z } from "zod";
import type { SessionEvent } from "./events";
import type { Session } from "./session";

export type { ModelMessage } from "ai";
export * from "./events";
export * from "./session";

export type Tone = "muted" | "accent" | "highlight" | "warning" | "danger";
export type Span = { text: string; tone?: Tone; bold?: boolean; fill?: boolean };
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
  execute: (input: z.infer<Schema>, signal: AbortSignal | undefined) => string | Promise<string>;
  renderCall?: (input: z.infer<Schema>) => Line[];
  renderResult?: (result: string, ok: boolean) => Line[];
};

export type Key = { key: string; ctrl: boolean; shift: boolean; text: string };
export type Capture = {
  render: (columns: number) => Line[];
  onKey: (key: Key) => void;
};

export type CommandSpec = {
  description: string;
  run: (args: string) => void | Promise<void>;
};

export type UiHost = {
  print?: (content: unknown) => void;
  ask?: (questions: readonly unknown[]) => Promise<string>;
  capture: (spec: Capture) => { close: () => void; repaint: () => void };
  status?: (render: () => string | null) => void;
  footer?: (render: () => unknown) => void;
  activity?: (render: (state: unknown) => unknown) => void;
};

export type SkillSummary = {
  name: string;
  command: string;
  description: string;
  location: string;
  modelInvocable: boolean;
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
  tool_timeout_ms?: number;
  steering_mode?: "one-at-a-time" | "all";
  follow_up_mode?: "one-at-a-time" | "all";
};

export type ExtensionContext = {
  root: string;
  mode: "tui" | "print";
  hasUI: boolean;
  z: typeof z;
  ui: UiHost;
  tool: <Schema extends z.ZodType>(spec: ToolSpec<Schema>) => void;
  command: (name: string, spec: CommandSpec) => void;
  on: (event: string, handler: (payload: unknown) => unknown) => void;
  exec: (
    command: string,
    args?: readonly string[],
  ) => Promise<{ output: string; stdout: string; ok: boolean }>;
  send: (text: string, options?: { label?: string; steer?: boolean }) => void;
  print: (content: string | Line[], tone?: Tone) => void;
  columns: () => number;
  clip: (text: string, limit: number) => string;
  inspect: () => {
    commands: readonly { name: string; description: string }[];
    skills: readonly SkillSummary[];
    extensions: readonly LoadedExtension[];
  };
  clear: () => "cleared" | "busy" | "empty";
  compact: (options?: { instruction?: string; keep?: number }) => Promise<Compaction>;
  reload: () => Promise<void>;
  usage: () => Usage;
  session: () => { id: string; file: string; title: string; events: number };
  prompt: (text: string) => void;
  settings: () => Readonly<Settings>;
  available: () => ReadonlyArray<{
    name: string;
    summary: string;
    state: "on" | "off" | "undecided";
  }>;
  setExtension: (
    name: string,
    on: boolean,
  ) => Promise<"written" | "not-allowed" | "already" | "failed" | "unknown">;
};

export type Glrs = ExtensionContext;
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

export type { Extension as ExtensionFactory };
