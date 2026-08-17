import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import type { Agent } from "./agent";
import { type ChatSignal, createChat } from "./chat";
import type { SessionEvent } from "./events";
import { REMINDER_CLOSE, REMINDER_OPEN } from "./prompt";
import type { ToolEvent } from "./tools";

type Outcome = Awaited<ReturnType<Agent["run"]>>;

const done = (text: string, extra: Partial<Outcome> = {}): Outcome => ({
  text,
  messages: [{ role: "assistant", content: text } as ModelMessage],
  stoppedAtStepLimit: false,
  ...extra,
});

const harness = (script: Array<() => Outcome>) => {
  const prompts: string[] = [];
  const histories: number[] = [];
  const events: SessionEvent[] = [];
  const agent = {
    run: async (prompt: string, history: ModelMessage[]) => {
      prompts.push(prompt);
      histories.push(history.length);
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next();
    },
  } as unknown as Agent;
  const chat = createChat(agent, {
    onEvent: (event) => events.push(event),
    onSignal: () => {},
  });
  return { chat, prompts, histories, events };
};

const settle = async (chat: ReturnType<typeof createChat>): Promise<void> => {
  for (let n = 0; n < 200 && chat.busy; n += 1) await Bun.sleep(1);
};

describe("the reminder channel", () => {
  test("a step-limited turn puts a reminder on the next prompt", async () => {
    const { chat, prompts } = harness([
      () => done("", { stoppedAtStepLimit: true }),
      () => done("ok"),
    ]);
    chat.send("first");
    await settle(chat);
    chat.send("second");
    await settle(chat);

    expect(prompts[0]).toBe("first");
    // The request leads; the reminder trails it. A model that led with the
    // reminder answered it instead of the request.
    expect(prompts[1]).toStartWith("second");
    expect(prompts[1]).toContain("ran out of steps");
    expect(prompts[1]).toContain(REMINDER_OPEN);
    expect(prompts[1]).toEndWith(REMINDER_CLOSE);
  });

  test("a failed turn reports the failure to the next turn", async () => {
    const { chat, prompts } = harness([
      () => {
        throw new Error("connection reset");
      },
      () => done("ok"),
    ]);
    chat.send("first");
    await settle(chat);
    chat.send("second");
    await settle(chat);

    expect(prompts[1]).toContain("connection reset");
    expect(prompts[1]).toStartWith("second");
  });

  test("it fires once, not on every following turn", async () => {
    const { chat, prompts } = harness([
      () => done("", { stoppedAtStepLimit: true }),
      () => done("ok"),
      () => done("ok"),
    ]);
    for (const text of ["first", "second", "third"]) {
      chat.send(text);
      await settle(chat);
    }

    expect(prompts[1]).toContain(REMINDER_OPEN);
    expect(prompts[2]).toBe("third");
  });

  test("a clean turn adds nothing", async () => {
    const { chat, prompts } = harness([() => done("ok"), () => done("ok")]);
    chat.send("first");
    await settle(chat);
    chat.send("second");
    await settle(chat);

    expect(prompts[1]).toBe("second");
  });
});

describe("clearing the conversation", () => {
  test("it drops the history the next turn would have replayed", async () => {
    const { chat, histories } = harness([() => done("one"), () => done("two")]);
    chat.send("first");
    await settle(chat);
    // the first turn left messages behind; asserting on the prompt text would
    // pass whether or not they were dropped, so measure what run() receives
    expect(chat.clear()).toBe("cleared");
    chat.send("second");
    await settle(chat);
    expect(histories[0]).toBe(0);
    expect(histories[1]).toBe(0);
  });

  test("without a clear, the next turn does carry the history forward", async () => {
    const { chat, histories } = harness([() => done("one"), () => done("two")]);
    chat.send("first");
    await settle(chat);
    chat.send("second");
    await settle(chat);
    expect(histories[1]).toBeGreaterThan(0);
  });

  test("an untouched session has nothing to clear", () => {
    const { chat } = harness([]);
    expect(chat.clear()).toBe("empty");
  });

  test("it refuses mid-turn, because the running request would undo it", async () => {
    const { chat } = harness([() => done("slow"), () => done("next")]);
    chat.send("first");
    // the turn is queued and running now
    expect(chat.clear()).toBe("busy");
    await settle(chat);
  });

  test("a pending reminder does not survive the clear", async () => {
    const { chat, prompts } = harness([
      () => done("", { stoppedAtStepLimit: true }),
      () => done("ok"),
    ]);
    chat.send("first");
    await settle(chat);
    expect(chat.clear()).toBe("cleared");
    chat.send("second");
    await settle(chat);
    expect(prompts[1]).not.toContain("ran out of steps");
  });
});

describe("sending an expanded slash command", () => {
  const big = "X".repeat(30_000);

  test("the transcript shows what was typed, not the expansion", async () => {
    const { chat, events } = harness([() => done("ok")]);
    chat.send(big, "/graphify .");
    await settle(chat);
    const said = events.filter((event) => event.type === "user");
    const shown = events.filter((event) => event.type === "notice");
    // a 30k body echoed as the user's own words buries the session
    expect(said).toHaveLength(0);
    expect(shown[0]).toMatchObject({ text: "/graphify ." });
  });

  test("the model still receives the full expansion", async () => {
    const { chat, prompts } = harness([() => done("ok")]);
    chat.send(big, "/graphify .");
    await settle(chat);
    expect(prompts[0]).toContain(big);
  });

  test("an ordinary message is still echoed as the user's own", async () => {
    const { chat, events } = harness([() => done("ok")]);
    chat.send("just asking");
    await settle(chat);
    expect(events.filter((event) => event.type === "user")[0]).toMatchObject({
      text: "just asking",
    });
  });
});

describe("tool events reaching the transcript", () => {
  const toolEvent = (over: Partial<ToolEvent> = {}): ToolEvent =>
    ({ id: 1, name: "read", detail: "a.ts", phase: "end", ok: true, ...over }) as ToolEvent;

  const drive = async (events: ToolEvent[]) => {
    const seen: SessionEvent[] = [];
    const signalled: ChatSignal[] = [];
    const agent = {
      run: async (
        _prompt: string,
        _history: ModelMessage[],
        turn: { onTool: (e: ToolEvent) => void },
      ) => {
        for (const event of events) turn.onTool(event);
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, {
      onEvent: (event) => seen.push(event),
      onSignal: (value) => signalled.push(value),
    });
    chat.send("go");
    await settle(chat);
    return { seen, signalled };
  };

  // Every tool call is now the agent's own — there is no second agent whose
  // calls have to be filtered out. The transcript records one row per call.
  test("a completed call becomes one transcript row", async () => {
    const { seen } = await drive([
      toolEvent({ id: 1, name: "read", phase: "start" } as Partial<ToolEvent>),
      toolEvent({ id: 1, name: "read" }),
    ]);
    expect(seen.filter((event) => event.type === "tool")).toMatchObject([{ name: "read" }]);
  });

  test("a start on its own records nothing, so a running call cannot look finished", async () => {
    const { seen } = await drive([
      toolEvent({ id: 1, name: "bash", phase: "start" } as Partial<ToolEvent>),
    ]);
    expect(seen.filter((event) => event.type === "tool")).toHaveLength(0);
  });

  test("both phases are signalled, which is what paints the running row", async () => {
    const { signalled } = await drive([
      toolEvent({ id: 1, name: "bash", phase: "start" } as Partial<ToolEvent>),
      toolEvent({ id: 1, name: "bash" }),
    ]);
    expect(signalled.filter((value) => value.type === "tool")).toHaveLength(2);
  });
});

describe("streaming deltas", () => {
  type Turn = {
    onDelta: (d: { kind: "text" | "reasoning"; text: string }) => void;
    onReasoningEnd: (r: { text: string; elapsedMs: number }) => void;
    onStep: (s: {
      text: string;
      contextTokens: number;
      cachedTokens: number;
      outputTokens: number;
    }) => void;
  };

  const streamed = (script: (turn: Turn) => void) => {
    const seen: SessionEvent[] = [];
    const signalled: ChatSignal[] = [];
    const agent = {
      run: async (_p: string, _h: ModelMessage[], turn: Turn) => {
        script(turn);
        return done("final answer");
      },
    } as unknown as Agent;
    const chat = createChat(agent, {
      onEvent: (e) => seen.push(e),
      onSignal: (v) => signalled.push(v),
    });
    return { chat, seen, signalled };
  };

  test("a burst of deltas costs one signal, not one per delta", async () => {
    const { chat, signalled } = streamed((turn) => {
      for (const piece of ["a", "b", "c", "d", "e"]) turn.onDelta({ kind: "text", text: piece });
    });
    chat.send("go");
    await settle(chat);
    chat.flush();
    const deltas = signalled.filter((v) => v.type === "delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ text: "abcde" });
  });

  test("nothing is signalled until a flush, so partial words never paint alone", async () => {
    const { chat, signalled } = streamed((turn) => {
      turn.onDelta({ kind: "text", text: "hel" });
      expect(signalled.filter((v) => v.type === "delta")).toHaveLength(0);
      turn.onDelta({ kind: "text", text: "lo" });
    });
    chat.send("go");
    await settle(chat);
    chat.flush();
    expect(signalled.filter((v) => v.type === "delta")[0]).toMatchObject({ text: "hello" });
  });

  test("switching kind flushes, so reasoning and answer never merge into one block", async () => {
    const { chat, signalled } = streamed((turn) => {
      turn.onDelta({ kind: "reasoning", text: "thinking" });
      turn.onDelta({ kind: "text", text: "answering" });
    });
    chat.send("go");
    await settle(chat);
    chat.flush();
    const deltas = signalled.filter((v) => v.type === "delta");
    expect(deltas.map((d) => d.kind)).toEqual(["reasoning", "text"]);
  });

  test("reasoning is recorded durably, with its duration", async () => {
    const { chat, seen } = streamed((turn) => {
      turn.onDelta({ kind: "reasoning", text: "weighing options" });
      turn.onReasoningEnd({ text: "weighing options", elapsedMs: 4200 });
    });
    chat.send("go");
    await settle(chat);
    expect(seen.filter((e) => e.type === "reasoning")).toMatchObject([
      { text: "weighing options", elapsedMs: 4200 },
    ]);
  });

  test("the durable assistant event still lands, unchanged by streaming", async () => {
    const { chat, seen } = streamed((turn) => {
      turn.onDelta({ kind: "text", text: "final answer" });
    });
    chat.send("go");
    await settle(chat);
    expect(seen.filter((e) => e.type === "assistant")).toMatchObject([{ text: "final answer" }]);
  });
});

// Compaction is the answer to a full context that is not "throw it all away".
// The cut has to land on a user message: a tool result separated from the call
// it answers is an invalid request, and the provider rejects the whole turn.
describe("compacting a long conversation", () => {
  const conversation = (turns: number): ModelMessage[] =>
    Array.from({ length: turns }, (_, at) => [
      { role: "user" as const, content: `ask ${at} ${"x".repeat(400)}` },
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: `t${at}`, toolName: "read", input: {} },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: `t${at}`,
            toolName: "read",
            output: { type: "text" as const, value: "y".repeat(400) },
          },
        ],
      },
      { role: "assistant" as const, content: `answered ${at}` },
    ]).flat();

  const harnessWith = (history: ModelMessage[], summary = "the brief") => {
    const events: SessionEvent[] = [];
    let sent: ModelMessage[] = [];
    const agent = {
      summarise: async () => summary,
      run: async (_p: string, replayed: ModelMessage[]) => {
        sent = replayed;
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, {
      onEvent: (event) => events.push(event),
      onSignal: () => {},
      history,
    });
    return { chat, events, sent: () => sent };
  };

  // A tool message whose call was summarised away is an invalid request, and
  // the provider rejects the entire turn — so this is the invariant compaction
  // lives or dies by.
  const orphans = (messages: ModelMessage[]): string[] => {
    const called = new Set<string>();
    const loose: string[] = [];
    for (const message of messages) {
      if (message.role === "assistant" && Array.isArray(message.content))
        for (const part of message.content)
          if (part.type === "tool-call") called.add(part.toolCallId);
      if (message.role === "tool" && Array.isArray(message.content))
        for (const part of message.content) {
          const id = (part as { toolCallId?: string }).toolCallId;
          if (id !== undefined && !called.has(id)) loose.push(id);
        }
    }
    return loose;
  };

  test("the fixture would fail this check if cut anywhere", () => {
    // proves the check has teeth: slicing mid-turn orphans a result
    expect(orphans(conversation(4).slice(2))).not.toEqual([]);
  });

  test("what the next turn replays has no orphaned tool results", async () => {
    const { chat, sent } = harnessWith(conversation(12));
    expect((await chat.compact("summarise", 2_000)).outcome).toBe("compacted");
    chat.send("next");
    await settle(chat);
    expect(orphans(sent())).toEqual([]);
    expect(sent().length).toBeLessThan(conversation(12).length);
  });

  test("the summary leads the replayed history", async () => {
    const { chat, sent } = harnessWith(conversation(12), "WHAT HAPPENED BEFORE");
    await chat.compact("summarise", 2_000);
    chat.send("next");
    await settle(chat);
    expect(JSON.stringify(sent()[0])).toContain("WHAT HAPPENED BEFORE");
  });

  test("a short conversation is left alone", async () => {
    const { chat } = harnessWith(conversation(1));
    expect((await chat.compact("summarise", 50_000)).outcome).toBe("too-short");
  });

  test("an empty summary is a failure, not a silently emptied history", async () => {
    const { chat, events } = harnessWith(conversation(12), "");
    expect((await chat.compact("summarise", 2_000)).outcome).toBe("failed");
    expect(events.some((event) => event.type === "compacted")).toBe(false);
  });

  test("it refuses while a turn is running", async () => {
    const { chat } = harnessWith(conversation(12));
    chat.send("busy");
    expect((await chat.compact("summarise", 2_000)).outcome).toBe("busy");
    await settle(chat);
  });
});

// Reported from a live session: Esc during a turn with something queued pulled
// the queued message back and left the turn running, so it read as Esc doing
// nothing and the message was never sent.
describe("what Esc does", () => {
  test("it stops the running turn rather than the queued message", async () => {
    let aborted = false;
    const agent = {
      run: async (_p: string, _h: ModelMessage[], turn: { signal: AbortSignal }) => {
        turn.signal.addEventListener("abort", () => {
          aborted = true;
        });
        await Bun.sleep(30);
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("first");
    chat.send("queued");
    await Bun.sleep(5); // let the first turn actually start
    // exactly what index.ts's interrupt() does
    const stopped = chat.abort() || chat.dequeue() !== null;
    expect(stopped).toBe(true);
    expect(aborted).toBe(true);
    // the queued message is still queued, not silently removed
    expect(chat.queued).toEqual(["queued"]);
    await settle(chat);
  });

  test("with nothing running, it takes the newest queued message back", async () => {
    const { chat } = harness([() => done("a"), () => done("b")]);
    expect(chat.abort() || chat.dequeue() !== null).toBe(false);
  });
});

// The reminder trails the request. It led once, and a model answered it instead
// of the page of instructions that followed.
describe("where an interrupt reminder sits", () => {
  test("what the user typed comes first", async () => {
    const { chat, prompts } = harness([
      () => {
        throw new Error("stopped");
      },
      () => done("ok"),
    ]);
    chat.send("first");
    await settle(chat);
    chat.send("the actual new request");
    await settle(chat);
    expect(prompts[1]).toStartWith("the actual new request");
    expect(prompts[1]).toContain(REMINDER_OPEN);
    expect(prompts[1].indexOf("the actual new request")).toBeLessThan(
      prompts[1].indexOf(REMINDER_OPEN),
    );
  });
});
