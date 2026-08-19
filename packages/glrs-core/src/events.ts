import type { ModelMessage } from "ai";

export const PREAMBLE_TAGS = ["where-you-are", "skills", "extensions"] as const;

export type SessionEvent =
  // `steer` marks a message the user sent into a turn that was already running,
  // rather than one that started a turn. Optional so a session written before
  // steering existed still loads, and read by the TUI so a steering message is
  // not mistaken for the start of a new turn.
  | { type: "user"; text: string; steer?: boolean }
  | { type: "assistant"; text: string }
  // input and result are what an extension's renderer redraws from on replay;
  // both are optional so a session written before extensions still loads.
  | {
      type: "tool";
      name: string;
      detail: string;
      elapsedMs: number;
      ok: boolean;
      input?: Record<string, unknown>;
      result?: string;
    }
  | { type: "notice"; text: string }
  | { type: "error"; text: string }
  | {
      type: "usage";
      tokens: number;
      cached: number;
      input?: number;
      output?: number;
      cost?: number;
    }
  // Shown live while it streams, then collapsed to a single line. The full text
  // is kept so a resumed session replays faithfully and an expand affordance can
  // be added later without another schema change.
  | { type: "reasoning"; text: string; elapsedMs: number }
  // An extension's own data, persisted in the session and never sent to the
  // model. messagesOf ignores it; eventBlock draws nothing for it.
  | { type: "custom"; custom: string; data: unknown }
  | { type: "cleared"; reason: string }
  // The conversation up to this point, summarised. Replayed like a clear: the
  // fold restarts here and begins with the summary, so a resumed session
  // carries exactly the context the live one did rather than re-inflating to
  // the full history and blowing the limit again on the first turn.
  | { type: "compacted"; summary: string; dropped: number }
  | { type: "turn"; messages: ModelMessage[] };

// A clear resets what the model sees, not what the user sees. The transcript
// replays every event; the fold restarts at the last clear, so a resumed
// session inherits the same trimmed context the live one had.
export const messagesOf = (events: readonly SessionEvent[]): ModelMessage[] => {
  const restart = events.findLastIndex(
    (event) => event.type === "cleared" || event.type === "compacted",
  );
  const from = events[restart];
  const carried: ModelMessage[] =
    from?.type === "compacted" ? [{ role: "user", content: compactedPrompt(from.summary) }] : [];
  return [
    ...carried,
    ...events.slice(restart + 1).flatMap((event) => (event.type === "turn" ? event.messages : [])),
  ];
};

export const compactedPrompt = (summary: string): string =>
  `<earlier-conversation>\n${summary}\n</earlier-conversation>\n\nThe conversation above this point was compacted to stay within the context limit. Continue from the brief.`;

export type UsageTotals = {
  input: number;
  output: number;
  cached: number;
  cost: number;
  steps: number;
};

// Summed over every usage event the session holds, so a resumed session reports
// what it has spent in total rather than what it has spent since reopening.
// Unlike messagesOf this does not restart at the last clear: clearing drops what
// the model replays, not what the run cost.
export const usageTotals = (events: readonly SessionEvent[]): UsageTotals =>
  events.reduce<UsageTotals>(
    (carried, event) =>
      event.type !== "usage"
        ? carried
        : {
            input: carried.input + (event.input ?? 0),
            output: carried.output + (event.output ?? 0),
            cached: carried.cached + event.cached,
            cost: carried.cost + (event.cost ?? 0),
            steps: carried.steps + 1,
          },
    { input: 0, output: 0, cached: 0, cost: 0, steps: 0 },
  );

export const contextTokensOf = (events: readonly SessionEvent[]): number | undefined => {
  const last = events.findLast((event) => event.type === "usage");
  return last?.type === "usage" ? last.tokens : undefined;
};

export const messageText = (message: ModelMessage): string => {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
};

// Built from the list prompt.ts owns, so adding a preamble block there cannot
// leave it leaking into the replayed transcript.
const preambleBlock = new RegExp(
  `^(?:${[
    ...PREAMBLE_TAGS.map((tag) => `<${tag}>\\n[\\s\\S]*?\\n</${tag}>`),
    "\\[system-reminder\\]\\n[\\s\\S]*?\\n\\[/system-reminder\\]",
  ].join("|")})\\n\\n`,
  "u",
);

export const typedText = (message: ModelMessage): string => {
  let text = messageText(message);
  while (preambleBlock.test(text)) text = text.replace(preambleBlock, "");
  return text;
};

export const eventsFromMessages = (messages: readonly ModelMessage[]): SessionEvent[] => {
  if (messages.length === 0) return [];
  const shown = messages.flatMap((message): SessionEvent[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = message.role === "user" ? typedText(message) : messageText(message);
    return text.trim() === "" ? [] : [{ type: message.role, text }];
  });
  return [...shown, { type: "turn", messages: [...messages] }];
};
