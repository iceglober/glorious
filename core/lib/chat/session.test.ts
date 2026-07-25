import { describe, expect, test } from "bun:test";
import type { Agent, GenerateOptions } from "../agent";
import type { RunResult } from "../llm";
import type { ChatEvent } from "./events";
import { createChatSession } from "./session";

const result = (text: string, over: Partial<RunResult> = {}): RunResult => ({
  text,
  steps: [],
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  messages: [{ role: "assistant", content: text }],
  ...over,
});

function makeAgent(impl: (prompt: string, opts?: GenerateOptions) => Promise<RunResult>): Agent {
  return { composed: {} as Agent["composed"], generate: impl };
}

/** The session takes the agent as a promise; tests hand it a resolved fake. */
const agentOf = (impl: (prompt: string, opts?: GenerateOptions) => Promise<RunResult>) =>
  Promise.resolve(makeAgent(impl));

describe("createChatSession", () => {
  test("runs a turn and threads the continuation into the next one", async () => {
    const calls: Array<{ prompt: string; messages?: unknown[] }> = [];
    const events: ChatEvent[] = [];
    let turns = 0;
    const session = createChatSession({
      agent: agentOf(async (prompt, opts) => {
        turns += 1;
        calls.push({ prompt, messages: opts?.messages });
        return result(`answer ${turns}`, {
          messages: Array.from({ length: turns }, (_unused, index) => ({ turn: index + 1 })),
        });
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("what does this repo do?");
    expect(calls[0]).toMatchObject({ prompt: "what does this repo do?", messages: [] });

    await session.send("now build it");
    // The second turn receives the first turn's continuation verbatim.
    expect(calls[1]).toMatchObject({ prompt: "now build it", messages: [{ turn: 1 }] });

    expect(events.filter((event) => event.type === "assistant")).toHaveLength(2);
    expect(events.filter((event) => event.type === "turn-finished")).toHaveLength(2);
    expect(events.filter((event) => event.type === "submission-finished")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("submission-finished");
    expect(session.busy).toBe(false);
  });

  test("streams each step's assistant text (intermediate prose isn't dropped)", async () => {
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (_prompt, opts) => {
        // An intermediate step: the model explains, then calls a tool.
        opts?.onStep?.({
          text: "AgentJ is a terminal coding agent.",
          toolCalls: [{ name: "bash", input: {} }],
          toolResults: [{ name: "bash", output: "ok" }],
        });
        // The final step: a short closing message (also RunResult.text).
        opts?.onStep?.({ text: "Done — that's the shape of it.", toolCalls: [], toolResults: [] });
        return result("Done — that's the shape of it.");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("what does agentj do");

    // Both the intermediate explanation and the final message surface, and the
    // final isn't duplicated (it was already streamed as the last step).
    const texts = events
      .filter((e): e is Extract<ChatEvent, { type: "assistant" }> => e.type === "assistant")
      .map((e) => e.text);
    expect(texts).toEqual(["AgentJ is a terminal coding agent.", "Done — that's the shape of it."]);
    expect(events.filter((event) => event.type === "tool-call")).toEqual([
      { type: "tool-call", call: { name: "bash", input: {} } },
    ]);
    expect(events.filter((event) => event.type === "tool-result")).toEqual([
      { type: "tool-result", result: { name: "bash", output: "ok" } },
    ]);
  });

  test("a text-only turn emits the assistant text exactly once (no duplicate)", async () => {
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (_prompt, opts) => {
        opts?.onStep?.({ text: "Just an answer.", toolCalls: [], toolResults: [] });
        return result("Just an answer.");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("hi");

    expect(events.filter((e) => e.type === "assistant")).toHaveLength(1);
  });

  test("a final text that was never streamed still reaches the transcript", async () => {
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (_prompt, opts) => {
        opts?.onStep?.({ text: "", toolCalls: [{ name: "bash", input: {} }], toolResults: [] });
        return result("All done.");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("go");

    expect(
      events
        .filter((e): e is Extract<ChatEvent, { type: "assistant" }> => e.type === "assistant")
        .map((e) => e.text),
    ).toEqual(["All done."]);
  });

  test("an empty model reply still emits an assistant event (a silent turn looks like a hang)", async () => {
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async () => result("")),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("go");

    expect(events.filter((e) => e.type === "assistant")).toEqual([{ type: "assistant", text: "" }]);
  });

  test("automatically compacts at 75% of the configured context limit", async () => {
    const full = [
      { role: "user", content: "old" },
      { role: "assistant", content: "large" },
    ];
    const compacted = [{ role: "user", content: "summary" }];
    const events: ChatEvent[] = [];
    const continuations: Array<unknown[] | undefined> = [];
    const agent: Agent = {
      composed: {} as Agent["composed"],
      generate: async (_prompt, opts) => {
        continuations.push(opts?.messages);
        return result("done", {
          messages: full,
          steps: [
            {
              toolCalls: [],
              toolResults: [],
              usage: { inputTokens: 75, outputTokens: 1, totalTokens: 76 },
            },
          ],
        });
      },
      compactContinuation: (messages) => {
        expect(messages).toBe(full);
        return compacted;
      },
    };
    const session = createChatSession({
      agent: Promise.resolve(agent),
      contextSoftLimit: 100,
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("go");

    expect(events).toContainEqual({
      type: "notice",
      text: "Context compacted after reaching 75% of its soft limit.",
    });
    // The compacted continuation is what the next turn carries forward.
    await session.send("again");
    expect(continuations[1]).toBe(compacted);
  });

  test("stays uncompacted below the soft limit's 75% mark", async () => {
    const events: ChatEvent[] = [];
    let compactions = 0;
    const agent: Agent = {
      composed: {} as Agent["composed"],
      generate: async () =>
        result("done", {
          steps: [
            {
              toolCalls: [],
              toolResults: [],
              usage: { inputTokens: 74, outputTokens: 1, totalTokens: 75 },
            },
          ],
        }),
      compactContinuation: (messages) => {
        compactions += 1;
        return messages;
      },
    };
    const session = createChatSession({
      agent: Promise.resolve(agent),
      contextSoftLimit: 100,
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("go");

    expect(compactions).toBe(0);
    expect(events.some((event) => event.type === "notice")).toBe(false);
  });

  test("turn-usage counts only the foreground agent's own steps", async () => {
    const events: ChatEvent[] = [];
    // The session's turn-usage stream is fed exclusively by the foreground
    // agent's onStep callback, so a context soft limit keyed on turn-usage
    // measures only the conversation-growing context.
    const session = createChatSession({
      agent: agentOf(async (_prompt, opts) => {
        opts?.onStep?.({
          toolCalls: [],
          toolResults: [],
          usage: { inputTokens: 210_000, outputTokens: 40, totalTokens: 210_040 },
        });
        return result("done");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("go");

    expect(events.filter((event) => event.type === "turn-usage")).toEqual([
      {
        type: "turn-usage",
        usage: { inputTokens: 210_000, outputTokens: 40, totalTokens: 210_040 },
      },
    ]);
  });

  test("uses a transcript label without changing the model prompt", async () => {
    const prompts: string[] = [];
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (prompt) => {
        prompts.push(prompt);
        return result("built");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("internal implementation prompt", { transcriptText: "expand @plan.md" });

    expect(prompts).toEqual(["internal implementation prompt"]);
    expect(events.find((event) => event.type === "turn-started")).toEqual({
      type: "turn-started",
      text: "internal implementation prompt",
      transcriptText: "expand @plan.md",
    });
  });

  test("forwards internal blank lines to the agent unchanged", async () => {
    const prompts: string[] = [];
    const session = createChatSession({
      agent: agentOf(async (prompt) => {
        prompts.push(prompt);
        return result("ok");
      }),
    });
    const text = "first\n\n\n\nsecond";

    await session.send(text);

    expect(prompts).toEqual([text]);
  });

  test("queues messages sent during a running turn and runs them in order", async () => {
    let release: (() => void) | undefined;
    const prompts: string[] = [];
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) await new Promise<void>((r) => (release = r));
        return result(`${prompt} done`);
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    const first = session.send("slow question");
    await new Promise((r) => setTimeout(r, 5));
    expect(session.busy).toBe(true);

    const second = session.send("queued task", { transcriptText: "expand @task.md" });
    const third = session.send("later task");
    await new Promise((r) => setTimeout(r, 5));
    expect(events.find((event) => event.type === "turn-queued")).toEqual({
      type: "turn-queued",
      text: "queued task",
      transcriptText: "expand @task.md",
    });

    release?.();
    await Promise.all([first, second, third]);

    expect(prompts).toEqual(["slow question", "queued task", "later task"]); // FIFO drain
    expect(
      events
        .filter(
          (event) =>
            event.type === "turn-started" ||
            event.type === "turn-finished" ||
            event.type === "submission-finished",
        )
        .map((event) => event.type),
    ).toEqual([
      "turn-started",
      "turn-finished",
      "submission-finished",
      "turn-started",
      "turn-finished",
      "submission-finished",
      "turn-started",
      "turn-finished",
      "submission-finished",
    ]);
  });

  test("dequeue removes the newest queued message, resolves its send, and emits the event", async () => {
    let release: (() => void) | undefined;
    const prompts: string[] = [];
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) await new Promise<void>((r) => (release = r));
        return result("ok");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(session.dequeue()).toBeNull(); // idle: nothing queued

    const first = session.send("slow question");
    await new Promise((r) => setTimeout(r, 5));
    const second = session.send("queued a");
    const third = session.send("expanded queued b", { restoreText: "@queued-b.md" });

    expect(session.dequeue()).toBe("expanded queued b"); // LIFO: newest intent first
    await third; // its send resolves without ever running
    expect(session.dequeue()).toBe("queued a");
    expect(session.dequeue()).toBeNull(); // queue drained; the turn keeps running
    await second;

    release?.();
    await first;
    expect(prompts).toEqual(["slow question"]); // dequeued messages never reach the model
    expect(events.filter((event) => event.type === "turn-dequeued")).toEqual([
      { type: "turn-dequeued", text: "expanded queued b", restoreText: "@queued-b.md" },
      { type: "turn-dequeued", text: "queued a" },
    ]);
  });

  test("abort ends the turn as aborted and queues an interruption notice", async () => {
    const prompts: string[] = [];
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (prompt, opts) => {
        prompts.push(prompt);
        if (prompts.length === 1) {
          await new Promise((_resolve, reject) => {
            opts?.abortSignal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        }
        return result("ok");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    const turn = session.send("long running");
    await new Promise((r) => setTimeout(r, 5));
    expect(session.abort()).toBe(true);
    expect(session.abort()).toBe(true); // repeated interrupts do not emit duplicate requests
    await turn;
    expect(
      events
        .filter(
          (event) =>
            event.type === "turn-abort-requested" ||
            event.type === "turn-aborted" ||
            event.type === "turn-finished" ||
            event.type === "submission-finished",
        )
        .map((event) => event.type),
    ).toEqual(["turn-abort-requested", "turn-aborted", "turn-finished", "submission-finished"]);

    await session.send("next");
    expect(prompts[1]).toContain("was interrupted");
    expect(prompts[1]).toContain("next");
  });

  test("abort on an idle session reports nothing to interrupt", async () => {
    const session = createChatSession({ agent: agentOf(async () => result("ok")) });
    expect(session.abort()).toBe(false);
  });

  test("a step-limited turn queues a notice so the next turn knows it stopped early", async () => {
    const prompts: string[] = [];
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async (prompt) => {
        prompts.push(prompt);
        return prompts.length === 1 ? result("", { stepLimitReached: true }) : result("done");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("big task");
    expect(
      events.find((event) => event.type === "assistant" && event.stepLimitReached),
    ).toBeDefined();

    await session.send("continue");
    expect(prompts[1]).toContain("stopped at the step limit");
    expect(prompts[1]).toContain("continue");
  });

  test("turn errors surface as events and never kill the session", async () => {
    let failures = 0;
    const events: ChatEvent[] = [];
    const session = createChatSession({
      agent: agentOf(async () => {
        failures += 1;
        if (failures === 1) throw new Error("model exploded");
        return result("recovered");
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    await session.send("boom");
    expect(events).toContainEqual({ type: "turn-error", error: "model exploded" });
    expect(events.at(-1)?.type).toBe("submission-finished");
    expect(session.busy).toBe(false);

    await session.send("again");
    expect(events.filter((event) => event.type === "assistant")).toHaveLength(1);
  });
});

test("a failed turn's request survives into the next turn's notice", async () => {
  const prompts: string[] = [];
  let failNext = true;
  const session = createChatSession({
    agent: agentOf(async (prompt) => {
      prompts.push(prompt);
      if (failNext) {
        failNext = false;
        throw new Error("The operation timed out.");
      }
      return result("ok");
    }),
  });

  await session.send("add Orwell's rules to the base prompt");
  await session.send("try again");

  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("The previous turn failed (The operation timed out.)");
  expect(prompts[1]).toContain('Its request was: "add Orwell\'s rules to the base prompt"');
  expect(prompts[1]).toContain("try again");
});
