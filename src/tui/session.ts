import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "node:events";
export interface TaskInfo {
  id: string;
  title: string;
  unchecked: string[];
}

export type SessionStatus = "starting" | "working" | "waiting" | "done" | "failed";

export interface PendingQuestion {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  resolve: (answers: Record<string, string>) => void;
}

export interface PendingTool {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (decision: "allow" | "deny") => void;
}

export interface ConversationMessage {
  role: "assistant" | "user" | "tool";
  text: string;
  timestamp: number;
}

const PIPELINE_PROMPT = `You are running the full implementation pipeline. Execute these steps in order:
1. Start with /think — run the product strategy session. Ask your forcing questions and WAIT for the user to answer before proceeding.
2. After /think completes and validates the idea, run /work <section> to implement.
3. After /work completes, run /review to review the diff and fix any issues.
4. After /review is clean, run /ship to typecheck, commit, push, and create a PR.
Proceed to each step automatically after the previous one completes. If any step needs clarification from the user, ask and wait.`;

function buildSystemPrompt(task: TaskInfo | null): string {
  if (!task) return PIPELINE_PROMPT;
  return PIPELINE_PROMPT.replace("/work <section>", `/work ${task.id}: ${task.title}`);
}

interface UserMsg {
  type: "user";
  message: { role: "user"; content: string };
}

function userMessage(text: string): UserMsg {
  return { type: "user", message: { role: "user", content: text } };
}

export class Session extends EventEmitter {
  name: string;
  section: TaskInfo | null;
  worktreePath: string;
  status: SessionStatus = "starting";
  messages: ConversationMessage[] = [];
  streamingText = "";
  cost = 0;
  turns = 0;
  inputTokens = 0;
  outputTokens = 0;
  pendingQuestion: PendingQuestion | null = null;
  pendingTool: PendingTool | null = null;

  private initialPrompt: string;
  private inputQueue: UserMsg[] = [];
  private inputResolve: (() => void) | null = null;
  private queryInstance: AsyncGenerator<SDKMessage, void> | null = null;
  private abortController = new AbortController();

  constructor(opts: {
    name: string;
    section: TaskInfo | null;
    worktreePath: string;
    prompt: string;
  }) {
    super();
    this.name = opts.name;
    this.section = opts.section;
    this.worktreePath = opts.worktreePath;
    this.initialPrompt = opts.prompt;
  }

  private async *generateMessages(): AsyncGenerator<UserMsg> {
    yield userMessage(this.initialPrompt);

    while (true) {
      if (this.inputQueue.length === 0) {
        await new Promise<void>((r) => {
          this.inputResolve = r;
        });
      }
      const msg = this.inputQueue.shift();
      if (msg) yield msg;
    }
  }

  kill() {
    this.abortController.abort();
    this.status = "failed";
    this.messages.push({ role: "tool", text: "Session killed by user", timestamp: Date.now() });
    // Unblock any pending promises
    if (this.pendingQuestion) { this.pendingQuestion.resolve({}); this.pendingQuestion = null; }
    if (this.pendingTool) { this.pendingTool.resolve("deny"); this.pendingTool = null; }
    this.inputResolve?.();
    this.emit("update");
  }

  sendMessage(text: string) {
    this.inputQueue.push(userMessage(text));
    this.messages.push({ role: "user", text, timestamp: Date.now() });
    this.inputResolve?.();
    this.inputResolve = null;
    this.emit("update");
  }

  start() {
    this.status = "working";
    this.emit("update");

    // Prevent unhandled 'error' events from crashing the process
    this.on("error", () => {});

    const gen = this.generateMessages();

    this.queryInstance = query({
      prompt: gen as any,
      options: {
        abortController: this.abortController,
        cwd: this.worktreePath,
        includePartialMessages: true,
        settingSources: ["project" as any],
        tools: { type: "preset", preset: "claude_code" } as any,
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          return this.handleToolApproval(toolName, input);
        },
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: buildSystemPrompt(this.section),
        } as any,
      },
    }) as any;

    this.processEvents();
  }

  private async processEvents() {
    try {
      for await (const msg of this.queryInstance!) {
        const m = msg as SDKMessage;

        if (m.type === "system") {
          this.status = "working";
          this.emit("update");
        }

        if (m.type === "assistant") {
          const am = m as SDKAssistantMessage;
          const text = this.extractText(am);
          if (text) {
            this.messages.push({ role: "assistant", text, timestamp: Date.now() });
            this.streamingText = "";
          }
          this.turns++;
          // Track token usage from the complete assistant message
          const usage = (am.message as any)?.usage;
          if (usage) {
            this.inputTokens += usage.input_tokens ?? 0;
            this.outputTokens += usage.output_tokens ?? 0;
          }
          this.emit("update");
        }

        if (m.type === "stream_event") {
          const evt = (m as any).event;
          if (evt?.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            this.streamingText += evt.delta.text;
            this.status = "working";
            this.emit("stream");
          }
          // Capture usage from message_delta events (has cumulative usage)
          if (evt?.type === "message_delta" && evt.usage) {
            this.outputTokens += evt.usage.output_tokens ?? 0;
          }
        }

        if (m.type === "result") {
          const rm = m as SDKResultMessage;
          // Result has the authoritative totals — use them
          this.cost = rm.total_cost_usd;
          if (rm.num_turns > this.turns) this.turns = rm.num_turns;
          const usage = (rm as any).usage;
          if (usage) {
            // Take the max of our accumulated count and the result's total
            // (result should have the authoritative cumulative total)
            if ((usage.input_tokens ?? 0) > this.inputTokens) {
              this.inputTokens = usage.input_tokens;
            }
            if ((usage.output_tokens ?? 0) > this.outputTokens) {
              this.outputTokens = usage.output_tokens;
            }
          }
          if (rm.is_error) {
            this.status = "failed";
          } else {
            this.status = "waiting";
          }
          this.emit("update");
        }
      }
    } catch (err: any) {
      // EPIPE means the subprocess exited — not a fatal error for the TUI
      const isEpipe = err?.code === "EPIPE" || (err instanceof Error && err.message.includes("EPIPE"));
      this.status = "failed";
      this.messages.push({
        role: "tool",
        text: isEpipe
          ? "Session subprocess exited unexpectedly"
          : `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
      // Clean up pending promises so the UI doesn't hang
      if (this.pendingQuestion) { this.pendingQuestion.resolve({}); this.pendingQuestion = null; }
      if (this.pendingTool) { this.pendingTool.resolve("deny"); this.pendingTool = null; }
      this.emit("update");
    }
  }

  private async handleToolApproval(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<any> {
    if (toolName === "AskUserQuestion") {
      return new Promise((resolve) => {
        this.pendingQuestion = {
          questions: input.questions as any,
          resolve: (answers) => {
            this.pendingQuestion = null;
            this.status = "working";
            this.emit("update");
            resolve({
              behavior: "allow",
              updatedInput: { questions: input.questions, answers },
            });
          },
        };
        this.status = "waiting";
        this.emit("question");
      });
    }

    // Log the tool call — clear streaming text first so
    // the tool call appears after whatever text was streaming
    if (this.streamingText.trim()) {
      this.messages.push({ role: "assistant", text: this.streamingText, timestamp: Date.now() });
      this.streamingText = "";
    }
    const summary = this.formatToolCall(toolName, input);
    this.messages.push({ role: "tool", text: summary, timestamp: Date.now() });
    this.emit("update");

    // Auto-allow everything — the worktree is isolated.
    return { behavior: "allow", updatedInput: input };
  }

  private formatToolCall(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case "Bash":
        return `Bash: ${input.command ?? ""}`;
      case "Read":
        return `Read: ${input.file_path ?? ""}`;
      case "Write":
        return `Write: ${input.file_path ?? ""}`;
      case "Edit":
        return `Edit: ${input.file_path ?? ""}`;
      case "Glob":
        return `Glob: ${input.pattern ?? ""}`;
      case "Grep":
        return `Grep: ${input.pattern ?? ""} ${input.path ? "in " + input.path : ""}`;
      case "Agent":
        return `Agent: ${input.description ?? input.prompt ?? ""}`;
      case "Skill":
        return `Skill: ${input.skill ?? ""}`;
      default:
        return `${toolName}: ${JSON.stringify(input).slice(0, 80)}`;
    }
  }

  private extractText(msg: SDKAssistantMessage): string {
    const message = msg.message as any;
    if (!message?.content) return "";
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    }
    return "";
  }
}
