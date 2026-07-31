/**
 * What a run cost, read back off the log.
 *
 * Nothing here is instrumentation: the events already record every request,
 * every completion, and whether it was served from cache, so the summary is a
 * pure fold over a recorded branch. That also means it works on a log from
 * last week as well as on the run that just finished.
 */

import type { LlmUsage } from "../domain/effects";
import type { AnyEvent } from "../domain/events";
import type { SchemaDef } from "../domain/schema";

export interface RunSummary {
  /** Completions the behaviors asked for, however they were served. */
  readonly llmCalls: number;
  /** Of those, the ones the log's own cache answered — free and instant. */
  readonly cachedCalls: number;
  /** Prompt + system characters actually sent to the provider. */
  readonly sentChars: number;
  /** Characters the cache saved from being sent again. */
  readonly savedChars: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cachedInputTokens: number;
  readonly commands: number;
  readonly failedCommands: number;
  /** Highest review round any command belongs to; 0 means the plan sufficed. */
  readonly rounds: number;
}

const requestChars = (request: unknown): number => {
  const { system, prompt } = (request ?? {}) as { system?: string; prompt?: string };
  return (system?.length ?? 0) + (prompt?.length ?? 0);
};

export const summarizeRun = <S extends SchemaDef>(log: Iterable<AnyEvent<S>>): RunSummary => {
  const chars = new Map<string, number>();
  let llmCalls = 0;
  let cachedCalls = 0;
  let sentChars = 0;
  let savedChars = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cachedInputTokens = 0;
  let commands = 0;
  let failedCommands = 0;
  let rounds = 0;

  for (const event of log) {
    const type = event.type as string;
    if (type === "llm.requested") {
      const payload = event.payload as { requestId: string; request: unknown };
      chars.set(payload.requestId, requestChars(payload.request));
    } else if (type === "llm.responded") {
      const payload = event.payload as {
        requestId: string;
        cached: boolean;
        response: { usage?: LlmUsage };
      };
      llmCalls += 1;
      const size = chars.get(payload.requestId) ?? 0;
      if (payload.cached) {
        cachedCalls += 1;
        savedChars += size;
      } else {
        sentChars += size;
      }
      const usage = payload.response.usage;
      inputTokens += usage?.inputTokens ?? 0;
      outputTokens += usage?.outputTokens ?? 0;
      reasoningTokens += usage?.reasoningTokens ?? 0;
      cachedInputTokens += usage?.cachedInputTokens ?? 0;
    } else if (type === "object.created") {
      const payload = event.payload as { objectType: string; data: { round?: number } };
      if (payload.objectType !== "command") continue;
      commands += 1;
      rounds = Math.max(rounds, payload.data.round ?? 0);
    } else if (type === "object.patched") {
      const payload = event.payload as { objectType: string; patch: { status?: string } };
      if (payload.objectType === "command" && payload.patch.status === "failed") {
        failedCommands += 1;
      }
    }
  }

  return {
    llmCalls,
    cachedCalls,
    sentChars,
    savedChars,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    commands,
    failedCommands,
    rounds,
  };
};

const thousands = (value: number): string => value.toLocaleString("en-US");

export const formatRunSummary = (summary: RunSummary): string => {
  const calls =
    summary.cachedCalls === 0
      ? `${summary.llmCalls} llm call(s)`
      : `${summary.llmCalls} llm call(s), ${summary.cachedCalls} from cache`;
  const tokens =
    summary.inputTokens + summary.outputTokens === 0
      ? "tokens: not reported by the provider"
      : `tokens: ${thousands(summary.inputTokens)} in` +
        (summary.cachedInputTokens === 0
          ? ""
          : ` (${thousands(summary.cachedInputTokens)} provider-cached)`) +
        `, ${thousands(summary.outputTokens)} out` +
        (summary.reasoningTokens === 0 ? "" : ` (${thousands(summary.reasoningTokens)} reasoning)`);
  const commands =
    summary.failedCommands === 0
      ? `${summary.commands} command(s)`
      : `${summary.commands} command(s), ${summary.failedCommands} failed`;
  return [
    `${calls} over ${summary.rounds + 1} round(s)`,
    tokens,
    `context sent: ${thousands(summary.sentChars)} chars` +
      (summary.savedChars === 0 ? "" : `, ${thousands(summary.savedChars)} saved by cache`),
    commands,
  ].join("\n  ");
};
