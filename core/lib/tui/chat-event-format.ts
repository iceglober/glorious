import type { ChatEvent } from "../chat/events";
import { truncateWithNotice } from "../truncation";
import type { UiTextLine } from "./styles";

/** Keep a bounded single-line preview while making the omitted character count explicit. */
export const truncateLineWithNotice = (value: string, maxLength: number): string =>
  truncateWithNotice(value.replace(/\r\n?|\n/gu, " "), maxLength);

/** Render a ChatEvent as transcript text. */
export const formatChatEvent = (event: ChatEvent): string | null => {
  switch (event.type) {
    case "turn-started":
      return event.transcriptText ?? `> ${event.text}`;
    case "turn-queued":
      return null;
    case "turn-dequeued":
      return `(dequeued) ${(event.restoreText ?? event.text).split("\n")[0]?.slice(0, 60) ?? ""}`;
    case "tool-call":
      return null;
    case "assistant": {
      const body = event.text.trim();
      if (event.stepLimitReached)
        return `${body.length > 0 ? `${body}\n` : ""}(step limit reached — turn stopped mid-work; send "continue" to resume)`;
      return body.length > 0 ? body : null;
    }
    case "turn-aborted":
      return "(turn interrupted)";
    case "turn-error":
      return `error: ${event.error}`;
    case "notice":
      return event.text;
    default:
      return null;
  }
};

/** Keep activity state legible in monochrome while giving active outcomes a semantic tone. */
export const presentActivityLine = (text: string): UiTextLine => {
  const trimmed = text.trimStart();
  const tone =
    trimmed.startsWith("✓") || trimmed.startsWith("Done")
      ? "success"
      : trimmed.startsWith("x") || trimmed.startsWith("✗") || trimmed.startsWith("Failed")
        ? "danger"
        : trimmed.startsWith("!") || trimmed.startsWith("Blocked")
          ? "warning"
          : trimmed.startsWith("↳ queued")
            ? "warning"
            : trimmed.startsWith("In progress") ||
                trimmed.startsWith("█") || // the running-tool sweep
                trimmed.startsWith("◐") ||
                trimmed.startsWith("◓") ||
                trimmed.startsWith("◑") ||
                trimmed.startsWith("◒")
              ? "accent"
              : trimmed.startsWith("·")
                ? "muted"
                : undefined;
  return tone ? [{ text, tone }] : text;
};
