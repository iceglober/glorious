import { tool } from "ai";
import type { z } from "zod";
import { capText, RESULT_LIMIT } from "../../glrs-core/src/shell";
import { errorText } from "./render";

// What every tool call goes through, whichever package defined the tool. The
// six that touch the machine live in the builtins extension now and register
// through `g.tool` exactly as yours would; what is left here is the machinery
// they and your tools share — one event counter, one gate, one result cap.
//
// Deliberately not moved into core alongside shell.ts: `wrapTool` needs
// `errorText`, which reaches into the renderer's grapheme handling. That is a
// bigger argument than this file needs to settle.

const FAILED = /^ERROR:|\[interrupted\]|\[timed out/u;

let events = 0;

// Every tool event in the process draws from one counter. chat.ts pairs start
// with end by id inside a single turn, and a turn can be running the parent's
// tools, several subagents' tools, and MCP tools at once — a per-instance
// counter made those collide.
export const nextToolEventId = (): number => {
  events += 1;
  return events;
};

// `input` and `result` are what an extension's renderer draws from — `detail`
// is only ever the one string a generic row can fit.
export type ToolEvent =
  | { id: number; name: string; detail: string; input: Record<string, unknown>; phase: "start" }
  | {
      id: number;
      name: string;
      detail: string;
      input: Record<string, unknown>;
      phase: "end";
      ok: boolean;
      result: string;
      // Measured here, where the call actually happens, so the transcript, the
      // session and an extension all read the same number rather than each
      // pairing start with end and arriving at their own.
      elapsedMs: number;
    };

export type ToolGate = {
  before: (name: string, input: Record<string, unknown>) => Promise<string | undefined>;
  after: (
    name: string,
    input: Record<string, unknown>,
    ok: boolean,
    result: string,
    elapsedMs: number,
  ) => Promise<string | undefined>;
};

let gate: ToolGate | null = null;

export const setToolGate = (next: ToolGate | null): void => {
  gate = next;
};

export const wrapTool = <Schema extends z.ZodType>(
  onEvent: (event: ToolEvent) => void,
  name: string,
  description: string,
  inputSchema: Schema,
  body: (input: z.infer<Schema>, signal: AbortSignal | undefined, id: number) => Promise<string>,
) => {
  const announce = (event: ToolEvent): void => {
    try {
      onEvent(event);
    } catch {}
  };
  return tool({
    description,
    inputSchema,
    execute: async (input: z.infer<Schema>, call: { abortSignal?: AbortSignal }) => {
      const raw = input as Record<string, unknown>;
      const step = { id: nextToolEventId(), name, detail: firstDetail(raw), input: raw };
      // Refused before it runs, and the model is told why, so it can choose
      // something else rather than seeing an unexplained failure.
      const refused = await gate?.before(name, raw);
      if (refused !== undefined) {
        announce({ ...step, phase: "start" });
        announce({ ...step, phase: "end", ok: false, result: refused, elapsedMs: 0 });
        return refused;
      }
      announce({ ...step, phase: "start" });
      const began = Date.now();
      const told = await body(input, call.abortSignal, step.id).catch(
        (bad) => `ERROR: ${errorText(bad)}`,
      );
      const elapsedMs = Date.now() - began;
      const capped = capText(told, RESULT_LIMIT);
      const ok = !FAILED.test(capped);
      const result = (await gate?.after(name, raw, ok, capped, elapsedMs)) ?? capped;
      announce({ ...step, phase: "end", ok, result, elapsedMs });
      return result;
    },
  });
};

export const firstDetail = (raw: Record<string, unknown>): string => {
  for (const key of ["command", "pattern", "path", "task"]) {
    const value = raw[key];
    if (typeof value === "string") return value;
  }
  const urls = raw.urls;
  if (Array.isArray(urls)) return urls.length === 1 ? String(urls[0]) : `${urls.length} pages`;
  const files = raw.files;
  if (Array.isArray(files))
    return files.length === 1
      ? String((files[0] as { path?: unknown })?.path ?? "")
      : `${files.length} files`;
  return "";
};

// What a call is worth saying about its own result, in a phrase. The row shows
// this instead of the last three lines of output: `432 lines` is what you want
// from a read, and the last three lines of a file are not.
//
// Keyed by name, like firstDetail above it, because these tools already return
// a known shape and a generic guess would be wrong more often than right — the
// last line of a file read is not a summary of anything. A tool that is not
// listed says how much came back, which is true of everything.
//
// An extension's tool describes itself through renderResult; its first line
// lands where this would. There is deliberately no second mechanism.
// Both words written out. Deriving one from the other needs a rule about -es
// after -ch, and a rule that is wrong once ships "1 fil".
const countable: Record<string, readonly [one: string, many: string]> = {
  read: ["line", "lines"],
  grep: ["match", "matches"],
  glob: ["file", "files"],
};

export const resultSummary = (name: string, result: string, ok: boolean): string => {
  // A failed call gets its reason on its own line, so the row itself says
  // nothing rather than saying it twice.
  if (!ok) return "";
  const lines = result.split("\n").filter((line) => line.trim() !== "");
  // "No matches." and "[truncated at N matches]" are prose about the result,
  // not part of it, so counting them would overstate by one.
  const body = lines.filter((line) => !line.startsWith("[truncated at "));
  const unit = countable[name];
  if (unit !== undefined) {
    if (body.length === 1 && body[0].startsWith("No ")) return body[0].replace(/\.$/u, "");
    return `${body.length} ${unit[body.length === 1 ? 0 : 1]}`;
  }
  // Everything else: one line is its own summary, and the last line of many is
  // where a command says how it went.
  if (body.length === 0) return "";
  return body.length === 1 ? body[0] : (body.at(-1) ?? "");
};
