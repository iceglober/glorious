/** The provider-facing conversational item. Providers may refine this shape. */
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

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

export type SessionEvent =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "reasoning"; text: string; elapsedMs: number }
  | { type: "tool"; call: ToolCall; phase: "start" | "end"; result?: string; ok?: boolean }
  | { type: "usage"; input: number; output: number; cached: number; cost?: number }
  | { type: "turn"; messages: readonly ModelMessage[] }
  | { type: "compacted"; dropped: number; kept: number };

export type Turn = {
  id: string;
  input: string;
  steps: readonly ModelStep[];
  events: readonly SessionEvent[];
  status: "running" | "settled" | "failed" | "aborted";
};

export type Session = {
  id: string;
  title: string;
  events: readonly SessionEvent[];
  parentId?: string;
};

export type SessionRepository = {
  create: (title?: string) => Promise<Session>;
  load: (id: string) => Promise<Session | null>;
  append: (id: string, events: readonly SessionEvent[]) => Promise<void>;
  fork: (id: string, atEvent?: number) => Promise<Session>;
};

export type ToolSpec<Input = unknown, Result = unknown> = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute?: (input: Input, signal?: AbortSignal) => Result | Promise<Result>;
  renderCall?: (input: Input) => unknown;
  renderResult?: (result: Result, ok: boolean) => unknown;
};

export type CommandSpec = {
  description: string;
  run: (args: string) => void | Promise<void>;
};

export type UiHost = {
  print?: (content: unknown) => void;
  ask?: (questions: readonly unknown[]) => Promise<string>;
  capture?: (spec: unknown) => { close: () => void };
  status?: (render: () => string | null) => void;
  footer?: (render: () => unknown) => void;
  activity?: (render: (state: unknown) => unknown) => void;
};

export type ExtensionContext = {
  root: string;
  mode: "interactive" | "headless";
  ui?: UiHost;
  tool: (spec: ToolSpec) => void;
  command: (name: string, spec: CommandSpec) => void;
  on: (event: string, handler: (payload: unknown) => unknown) => void;
};

export type Extension = (context: ExtensionContext) => void | Promise<void>;

export type ModelProvider = {
  id: string;
  model: (modelId: string, options?: Record<string, unknown>) => unknown;
};

export type AgentCore = {
  session: Session;
  runTurn: (input: string) => Promise<Turn>;
  reloadExtensions: () => Promise<void>;
};

export type { Extension as ExtensionFactory };
