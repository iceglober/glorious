import type { ModelMessage } from "ai";
import { PREAMBLE_TAGS } from "./prompt";

export type SessionEvent =
  | { type: "user"; text: string }
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
  | { type: "cleared"; reason: string }
  | { type: "turn"; messages: ModelMessage[] };

// A clear resets what the model sees, not what the user sees. The transcript
// replays every event; the fold restarts at the last clear, so a resumed
// session inherits the same trimmed context the live one had.
export const messagesOf = (events: readonly SessionEvent[]): ModelMessage[] => {
  const cleared = events.findLastIndex((event) => event.type === "cleared");
  return events
    .slice(cleared + 1)
    .flatMap((event) => (event.type === "turn" ? event.messages : []));
};

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
