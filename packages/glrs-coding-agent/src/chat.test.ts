import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import type { SessionEvent } from "../../glrs-core/src/events";
import type { Agent } from "./agent";
import { type ChatSignal, createChat } from "./chat";
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

  const harnessWith = (
    history: ModelMessage[],
    summary = "the brief",
    summarise?: (
      messages: ModelMessage[],
      instruction: string,
      signal?: AbortSignal,
    ) => Promise<string>,
  ) => {
    const events: SessionEvent[] = [];
    const signals: ChatSignal[] = [];
    let sent: ModelMessage[] = [];
    const agent = {
      summarise: summarise ?? (async () => summary),
      run: async (_p: string, replayed: ModelMessage[]) => {
        sent = replayed;
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, {
      onEvent: (event) => events.push(event),
      onSignal: (value) => signals.push(value),
      history,
    });
    return { chat, events, signals, sent: () => sent };
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

  // Reported from a live session: `/compact` on a 900k-token conversation ran
  // for a minute or two with nothing on screen, so a command that was working
  // read as one that had died.
  test("it reports a phase while it runs, so the screen is not still", async () => {
    const { chat, signals } = harnessWith(conversation(12));
    await chat.compact("summarise", 2_000);
    const phases = signals.flatMap((value) => (value.type === "phase" ? [value.name] : []));
    expect(phases).toEqual(["compacting", null]);
  });

  test("the phase clears even when the summary fails", async () => {
    const { chat, signals } = harnessWith(conversation(12), "");
    await chat.compact("summarise", 2_000);
    expect(signals.filter((value) => value.type === "phase").at(-1)).toEqual({
      type: "phase",
      name: null,
    });
  });

  // Two minutes is long enough that being unable to stop it is its own defect.
  // The stub rejects on abort the way a provider call does.
  test("Esc stops a compaction, and says that is what happened", async () => {
    const { chat } = harnessWith(
      conversation(12),
      "",
      (_messages, _instruction, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const running = chat.compact("summarise", 2_000);
    await Bun.sleep(5);
    expect(chat.abort()).toBe(true);
    expect(await running).toEqual({ outcome: "failed", error: "interrupted" });
  });

  test("a compaction that was stopped leaves the history alone", async () => {
    const { chat, sent } = harnessWith(
      conversation(12),
      "",
      (_messages, _instruction, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const running = chat.compact("summarise", 2_000);
    await Bun.sleep(5);
    chat.abort();
    await running;
    chat.send("next");
    await settle(chat);
    expect(sent()).toHaveLength(conversation(12).length);
  });

  test("the summary reaches the transcript, not just the model", async () => {
    const { chat, events } = harnessWith(conversation(12), "WHAT HAPPENED BEFORE");
    await chat.compact("summarise", 2_000);
    const shown = events.find((event) => event.type === "compacted");
    expect(shown).toMatchObject({ summary: "WHAT HAPPENED BEFORE" });
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
    expect(chat.abort()).toBe(true);
    expect(aborted).toBe(true);
    // the queued message is still queued, not silently removed and not sent
    expect(chat.queued.map((item) => item.text)).toEqual(["queued"]);
    expect(chat.held).toBe(true);
    await settle(chat);
    // and it stays that way: a held queue does not march on into whatever
    // state the interrupt left behind
    expect(chat.queued.map((item) => item.text)).toEqual(["queued"]);
  });

  test("with nothing running and nothing queued, there is nothing to stop", () => {
    const { chat } = harness([]);
    expect(chat.abort()).toBe(false);
    expect(chat.held).toBe(false);
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

// An agent whose turn has a known number of step boundaries and asks for
// steering at each one, exactly as agent.ts does through prepareStep. What it
// was handed at each boundary is recorded, so a test can say *when* a message
// arrived rather than only that it did — which is the whole difference between
// steering and queueing.
const stepping = (steps: number, onStart?: (run: number) => void) => {
  const delivered: string[][] = [];
  const prompts: string[] = [];
  let runs = 0;
  const agent = {
    run: async (
      prompt: string,
      _history: ModelMessage[],
      turn: { onSteer?: () => readonly string[]; onRetry?: (n: number, why: string) => void },
    ) => {
      prompts.push(prompt);
      onStart?.(runs++);
      for (let step = 0; step < steps; step += 1) {
        // yield, so anything queued from onStart has actually landed
        await Bun.sleep(0);
        delivered.push([...(turn.onSteer?.() ?? [])]);
      }
      return done("ok");
    },
  } as unknown as Agent;
  return { agent, delivered, prompts };
};

describe("a steering message joins the turn that is already running", () => {
  test("it arrives at the next step boundary, not as a new turn", async () => {
    let chat!: ReturnType<typeof createChat>;
    const { agent, delivered, prompts } = stepping(3, (run) => {
      if (run === 0) chat.send("actually, use bun", null, "steer");
    });
    chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("start");
    await settle(chat);
    // delivered at the first boundary, and the turn was never restarted
    expect(delivered).toEqual([["actually, use bun"], [], []]);
    expect(prompts).toEqual(["start"]);
  });

  test("the transcript records it as something the user said mid-turn", async () => {
    let chat!: ReturnType<typeof createChat>;
    const events: SessionEvent[] = [];
    const { agent } = stepping(2, (run) => {
      if (run === 0) chat.send("use bun", null, "steer");
    });
    chat = createChat(agent, { onEvent: (event) => events.push(event), onSignal: () => {} });
    chat.send("start");
    await settle(chat);
    const said = events.filter((event) => event.type === "user");
    expect(said).toEqual([
      { type: "user", text: "start" },
      // marked, so the TUI does not read it as the start of a new turn
      { type: "user", text: "use bun", steer: true },
    ]);
  });

  test("one at a time is one per boundary; all is everything at the first", async () => {
    const queueTwo = (chat: () => ReturnType<typeof createChat>) => (run: number) => {
      if (run !== 0) return;
      chat().send("a", null, "steer");
      chat().send("b", null, "steer");
    };

    let paced!: ReturnType<typeof createChat>;
    const one = stepping(
      3,
      queueTwo(() => paced),
    );
    paced = createChat(one.agent, { onEvent: () => {}, onSignal: () => {} });
    paced.send("start");
    await settle(paced);
    expect(one.delivered).toEqual([["a"], ["b"], []]);

    let bulk!: ReturnType<typeof createChat>;
    const every = stepping(
      3,
      queueTwo(() => bulk),
    );
    bulk = createChat(every.agent, {
      onEvent: () => {},
      onSignal: () => {},
      steeringMode: "all",
    });
    bulk.send("start");
    await settle(bulk);
    expect(every.delivered).toEqual([["a", "b"], [], []]);
  });

  // Waiting for a boundary that is never going to come is not a kinder
  // failure than simply answering.
  test("with nothing running there is nothing to steer, so it becomes the turn", async () => {
    const { chat, prompts } = harness([() => done("ok")]);
    chat.send("do it", null, "steer");
    await settle(chat);
    expect(prompts).toEqual(["do it"]);
  });

  test("a turn that ends before any boundary leaves it queued, not dropped", async () => {
    let chat!: ReturnType<typeof createChat>;
    // no boundaries at all: the turn answers and stops
    const { agent, prompts } = stepping(0, (run) => {
      if (run === 0) chat.send("too late", null, "steer");
    });
    chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("start");
    await settle(chat);
    expect(prompts).toEqual(["start", "too late"]);
  });

  // A dropped stream is re-sent from the first step. A message taken by the
  // attempt that died was delivered only to a request that was thrown away.
  test("a re-sent attempt gets the message the dead one took", async () => {
    const events: SessionEvent[] = [];
    const seen: string[][] = [];
    let chat!: ReturnType<typeof createChat>;
    let runs = 0;
    const agent = {
      run: async (
        _prompt: string,
        _history: ModelMessage[],
        turn: { onSteer?: () => readonly string[]; onRetry?: (n: number, why: string) => void },
      ) => {
        if (runs++ === 0) {
          // queued while this turn is running, which is what makes it steering
          chat.send("fix it", null, "steer");
          seen.push([...(turn.onSteer?.() ?? [])]);
          turn.onRetry?.(1, "socket closed");
          seen.push([...(turn.onSteer?.() ?? [])]);
        }
        return done("ok");
      },
    } as unknown as Agent;
    chat = createChat(agent, {
      onEvent: (event) => events.push(event),
      onSignal: () => {},
    });
    chat.send("start");
    await settle(chat);
    // the attempt that survived saw it too
    expect(seen).toEqual([["fix it"], ["fix it"]]);
    // and the transcript shows it once, not once per attempt
    expect(events.filter((event) => event.type === "user" && event.steer === true)).toHaveLength(1);
  });
});

describe("Esc holds the queue rather than marching it on", () => {
  test("sending anything releases it", async () => {
    const prompts: string[] = [];
    const agent = {
      run: async (prompt: string) => {
        prompts.push(prompt);
        await Bun.sleep(20);
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("first");
    chat.send("second");
    await Bun.sleep(5);
    chat.abort();
    await settle(chat);
    // "second" never ran: stopping the turn stopped the queue with it
    expect(prompts).toEqual(["first"]);
    expect(chat.held).toBe(true);
    // and starting work again is what releases it — no key of its own
    chat.send("third");
    await settle(chat);
    expect(prompts).toEqual(["first", "second", "third"]);
  });

  test("release lets it run without adding to it", async () => {
    let started = 0;
    const agent = {
      run: async () => {
        started += 1;
        await Bun.sleep(20);
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("first");
    chat.send("second");
    await Bun.sleep(5);
    chat.abort();
    await settle(chat);
    expect(started).toBe(1);
    expect(chat.held).toBe(true);
    // not busy: nothing is going to happen to a held queue until you say so
    expect(chat.busy).toBe(false);
    expect(chat.release()).toBe(true);
    await settle(chat);
    expect(started).toBe(2);
    expect(chat.queued).toEqual([]);
  });

  test("releasing an unheld queue reports that there was nothing to release", () => {
    const { chat } = harness([]);
    expect(chat.release()).toBe(false);
  });
});

describe("taking a queued message back", () => {
  test("the newest leaves the queue, whichever kind it is", async () => {
    let chat!: ReturnType<typeof createChat>;
    const { agent } = stepping(4, (run) => {
      if (run !== 0) return;
      chat.send("a follow-up");
      chat.send("a steer", null, "steer");
    });
    chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("start");
    await Bun.sleep(0);
    // the steering message was queued last, so it is what comes back first
    expect(chat.unqueue()?.text).toBe("a steer");
    expect(chat.unqueue()?.text).toBe("a follow-up");
    expect(chat.unqueue()).toBeNull();
    await settle(chat);
  });

  // Restoring the expanded body of a slash command would put a page of prompt
  // in the composer where "/review" was typed.
  test("a slash command comes back as what was typed", async () => {
    const agent = {
      run: async () => {
        await Bun.sleep(20);
        return done("ok");
      },
    } as unknown as Agent;
    const chat = createChat(agent, { onEvent: () => {}, onSignal: () => {} });
    chat.send("start");
    chat.send("the long expanded body of the review command", "/review");
    await Bun.sleep(5);
    const taken = chat.unqueue();
    expect(taken?.label).toBe("/review");
    expect(taken?.text).toBe("the long expanded body of the review command");
    chat.abort();
    await settle(chat);
  });
});

describe("how many follow-ups one turn takes", () => {
  test("one at a time by default", async () => {
    const { chat, prompts } = harness([() => done("1"), () => done("2"), () => done("3")]);
    chat.send("first");
    chat.send("second");
    chat.send("third");
    await settle(chat);
    expect(prompts).toEqual(["first", "second", "third"]);
  });

  test("all makes the queue a single turn", async () => {
    const script = [() => done("1"), () => done("2")];
    const prompts: string[] = [];
    const agent = {
      run: async (prompt: string) => {
        prompts.push(prompt);
        const next = script.shift();
        if (!next) throw new Error("script exhausted");
        await Bun.sleep(10);
        return next();
      },
    } as unknown as Agent;
    const chat = createChat(agent, {
      onEvent: () => {},
      onSignal: () => {},
      followUpMode: "all",
    });
    chat.send("first");
    await Bun.sleep(2);
    chat.send("second");
    chat.send("third");
    await settle(chat);
    expect(prompts).toEqual(["first", "second\n\nthird"]);
  });
});
