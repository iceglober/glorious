// Text and display primitives, in core because the runtime needs to describe
// output without knowing how it is drawn. Nothing here touches a terminal: the
// escape sequences live in the product's screen. The block builders that
// assemble a transcript are the product's too.

import type { Span } from "./index";

export type Line = Span[];

// Runtime and provider messages that mean something to whoever wrote them and
// nothing to whoever is using a coding agent. The Bun one tells you to pass
// `verbose: true` to a fetch you never called; a mid-stream drop is not
// retryable here (tokens may already be on screen), so the least glrs can
// do is say what happened.
const clearer: ReadonlyArray<[RegExp, string]> = [
  [
    /socket connection was closed unexpectedly/iu,
    'the connection to the model dropped mid-response, send "continue" to pick up where it stopped',
  ],
  [/^fetch failed$/iu, "could not reach the model: check the network and try again"],
  [/ECONNREFUSED/u, "the model endpoint refused the connection: check the host and port"],
  [/EAI_AGAIN|ENOTFOUND/u, "could not resolve the model host: check DNS and the resource name"],
];

// What was actually thrown, in words. `String(thrown)` was fine for an Error and
// produced "[object Object]" for everything else — and a provider SDK throws
// plain objects routinely, so a failed turn could report literally nothing.
// The shapes below are the ones that turn up: a nested `error`, a response body,
// an AggregateError's first cause. Anything unrecognised is serialised, because
// a wall of JSON is worth more than "[object Object]".
const DESCRIBE_LIMIT = 400;

export const describeThrown = (thrown: unknown): string => {
  if (typeof thrown === "string") return thrown;
  if (thrown instanceof Error) {
    if (thrown.message !== "") return thrown.message;
    // Some SDK errors carry an empty message and a populated cause.
    if (thrown.cause !== undefined) return describeThrown(thrown.cause);
    return thrown.name;
  }
  if (thrown === null || thrown === undefined) return "an unknown failure";
  if (typeof thrown !== "object") return String(thrown);
  const shape = thrown as Record<string, unknown>;
  for (const key of ["message", "error_description", "detail", "statusText"]) {
    const value = shape[key];
    if (typeof value === "string" && value !== "") return value;
  }
  for (const key of ["error", "cause", "data", "body", "responseBody"]) {
    const value = shape[key];
    if (value !== undefined && value !== thrown) {
      const said = describeThrown(value);
      if (said !== "" && !said.startsWith("{")) return said;
    }
  }
  if (Array.isArray(shape.errors) && shape.errors.length > 0)
    return describeThrown(shape.errors[0]);
  try {
    return clip(JSON.stringify(thrown), DESCRIBE_LIMIT);
  } catch {
    return "an unknown failure";
  }
};

export const errorText = (thrown: unknown): string => {
  const raw = describeThrown(thrown);
  return clearer.find(([pattern]) => pattern.test(raw))?.[1] ?? raw;
};

const splitter = new Intl.Segmenter("en", { granularity: "grapheme" });

const graphemes = (text: string): string[] =>
  [...splitter.segment(text)].map((piece) => piece.segment);

const wide = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0x1f1e6, 0x1f1ff],
  [0x1f300, 0x1faff],
  [0x1fc00, 0x10ffff],
];

const cells = (grapheme: string): number => {
  const points = [...grapheme].map((char) => char.codePointAt(0) ?? 0);
  if (points.includes(0xfe0f)) return 2;
  return wide.some(([low, high]) => points[0] >= low && points[0] <= high) ? 2 : 1;
};

export const width = (text: string): number =>
  graphemes(text).reduce((sum, part) => sum + cells(part), 0);

const noise = /[\p{Cc}\p{Bidi_Control}]/gu;

export const clean = (text: string): string =>
  text.replaceAll("\r", "").replace(noise, (char) => (char === "\n" ? "\n" : " "));

export const flatten = (text: string): string => clean(text).replaceAll("\n", " ").trim();

export const clip = (text: string, limit: number): string => {
  if (limit <= 0) return "";
  if (width(text) <= limit) return text;
  let room = limit - 1;
  let kept = "";
  for (const part of graphemes(text)) {
    room -= cells(part);
    if (room < 0) break;
    kept += part;
  }
  return `${kept}…`;
};

export const rightClip = (text: string, limit: number): string => {
  if (limit <= 0) return "";
  if (width(text) <= limit) return text;
  let room = limit - 1;
  const kept: string[] = [];
  const parts = graphemes(text);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    room -= cells(parts[index]);
    if (room < 0) break;
    kept.unshift(parts[index]);
  }
  return `…${kept.join("")}`;
};
