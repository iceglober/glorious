import { describe, expect, test } from "bun:test";
import { unwrap } from "../lib/fp";
import { hashRequest, type AnyEvent } from "../domain/events";
import { defineSchema } from "../domain/schema";
import { createFakeLlm } from "./fake-llm";
import { createMemoryCompletionCache, seedCacheFromLog, withCompletionCache } from "./llm-cache";

const schema = defineSchema({ objects: {}, relations: {}, events: {} });
type S1 = typeof schema;

describe("withCompletionCache", () => {
  test("caches by canonical request hash — the second identical call skips the port", async () => {
    let calls = 0;
    const inner = createFakeLlm((request) => {
      calls += 1;
      return `answer:${request.prompt}`;
    });
    const cached = withCompletionCache(inner, createMemoryCompletionCache());
    expect(unwrap(await cached.complete({ prompt: "q", model: "m" }))).toEqual({ text: "answer:q" });
    // Key-order-insensitive: same canonical request.
    expect(unwrap(await cached.complete({ model: "m", prompt: "q" }))).toEqual({ text: "answer:q" });
    expect(calls).toBe(1);
    expect(unwrap(await cached.complete({ prompt: "other" }))).toEqual({ text: "answer:other" });
    expect(calls).toBe(2);
  });
});

describe("seedCacheFromLog", () => {
  test("warms the cache from llm.responded events so replay never re-calls a provider", async () => {
    const request = { prompt: "summarize" };
    const requestHash = hashRequest(request);
    const log = [
      {
        id: 1,
        branch: "main",
        type: "llm.responded",
        payload: { requestId: "req_1_0", requestHash, response: { text: "recorded" }, cached: false },
        causedBy: null,
        at: "2026-01-01T00:00:00.000Z",
      } as AnyEvent<S1>,
    ];
    const cache = seedCacheFromLog(createMemoryCompletionCache(), log);
    expect(cache.get(requestHash)).toEqual({ text: "recorded" });

    let calls = 0;
    const inner = createFakeLlm(() => {
      calls += 1;
      return "fresh";
    });
    const llm = withCompletionCache(inner, cache);
    expect(unwrap(await llm.complete(request))).toEqual({ text: "recorded" });
    expect(calls).toBe(0);
  });
});
