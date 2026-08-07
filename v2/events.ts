import type { ModelMessage } from "ai";

export type SessionEvent =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; detail: string; elapsedMs: number; ok: boolean }
  | { type: "notice"; text: string }
  | { type: "error"; text: string }
  | { type: "usage"; tokens: number; cached: number }
  | { type: "turn"; messages: ModelMessage[] };

export const messagesOf = (events: readonly SessionEvent[]): ModelMessage[] =>
  events.flatMap((event) => (event.type === "turn" ? event.messages : []));

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

const preambleBlock =
  /^(?:<where-you-are>\n[\s\S]*?\n<\/where-you-are>|<skills>\n[\s\S]*?\n<\/skills>|\[system-reminder\]\n[\s\S]*?\n\[\/system-reminder\])\n\n/u;

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
