import { describe, expect, test } from "bun:test";
import { unwrap } from "../lib/fp";
import { createFakeLlm, createScriptedLlm, createUnreachableLlm } from "./fake-llm";

describe("fake llm adapters", () => {
  test("createFakeLlm answers from a pure responder — same request, same response", async () => {
    const llm = createFakeLlm((request) => `echo:${request.prompt}`);
    expect(unwrap(await llm.complete({ prompt: "hi" }))).toEqual({ text: "echo:hi" });
    expect(unwrap(await llm.complete({ prompt: "hi" }))).toEqual({ text: "echo:hi" });
  });

  test("createScriptedLlm replays responses in order and errs when exhausted", async () => {
    const llm = createScriptedLlm(["one", { text: "two" }]);
    expect(unwrap(await llm.complete({ prompt: "a" }))).toEqual({ text: "one" });
    expect(unwrap(await llm.complete({ prompt: "b" }))).toEqual({ text: "two" });
    expect(await llm.complete({ prompt: "c" })).toMatchObject({
      ok: false,
      error: { reason: "provider_error" },
    });
  });

  test("createUnreachableLlm always errs — reaching it is the failure signal", async () => {
    expect(await createUnreachableLlm("strict replay").complete({ prompt: "x" })).toMatchObject({
      ok: false,
      error: { reason: "provider_error" },
    });
  });
});
