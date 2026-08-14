import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import type { Agent } from "./agent";
import { type ChatSignal, createChat } from "./chat";
import type { SessionEvent } from "./events";
import { DEFAULT_MODE, type Mode } from "./modes";
import { REMINDER_CLOSE, REMINDER_OPEN } from "./prompt";
import type { ToolEvent } from "./tools";

type Outcome = Awaited<ReturnType<Agent["run"]>>;

const done = (text: string, extra: Partial<Outcome> = {}): Outcome => ({
  text,
  messages: [{ role: "assistant", content: text } as ModelMessage],
  stoppedAtStepLimit: false,
  ...extra,
});

const harness = (script: Array<() => Outcome>, planMode = false) => {
  const prompts: string[] = [];
  const histories: number[] = [];
  const events: SessionEvent[] = [];
  let mode = planMode ? { name: "plan", description: "", readOnly: true } : DEFAULT_MODE;
  const agent = {
    mode: () => mode,
    setMode: (next: Mode) => {
      mode = next;
    },
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
  return { chat, prompts, histories, events, mode: () => mode };
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
    expect(prompts[1]).toStartWith(REMINDER_OPEN);
    expect(prompts[1]).toContain("ran out of steps");
    expect(prompts[1]).toContain(REMINDER_CLOSE);
    expect(prompts[1]).toEndWith("second");
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
    expect(prompts[1]).toStartWith(REMINDER_OPEN);
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

describe("approving a plan", () => {
  test("switches to build mode and sends the plan as the next turn", async () => {
    const { chat, prompts, mode } = harness([() => done("presented"), () => done("built")], true);
    chat.planApproved("step one", ["a.ts"], false);
    chat.send("plan this");
    await settle(chat);
    expect(mode().readOnly).toBe(false);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("step one");
    expect(prompts[1]).toContain("a.ts");
  });

  test("a fresh approval clears the model's history but keeps the transcript", async () => {
    const { chat, prompts, events } = harness([() => done("presented"), () => done("built")], true);
    chat.planApproved("step one", [], true);
    chat.send("plan this");
    await settle(chat);
    expect(events.some((event) => event.type === "cleared")).toBe(true);
    // the second turn was sent with no prior history folded into it
    expect(prompts[1]).not.toContain("presented");
    expect(events.filter((event) => event.type === "user")).toHaveLength(1);
  });

  test("keeping context records no clear", async () => {
    const { chat, events } = harness([() => done("presented"), () => done("built")], true);
    chat.planApproved("step one", [], false);
    chat.send("plan this");
    await settle(chat);
    expect(events.some((event) => event.type === "cleared")).toBe(false);
  });

  test("the implementation turn is labelled, not echoed as the user's words", async () => {
    const { chat, events } = harness([() => done("presented"), () => done("built")], true);
    chat.planApproved("step one", [], false);
    chat.send("plan this");
    await settle(chat);
    const said = events.filter((event) => event.type === "user");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ text: "plan this" });
  });
});

describe("a plan turn that presents nothing", () => {
  test("is asked once more, and the ask is a system-reminder", async () => {
    const { chat, prompts } = harness([() => done("here is my plan"), () => done("ok")], true);
    chat.send("plan this");
    await settle(chat);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("present_plan");
  });

  test("is not asked a third time, so a model that will not comply cannot loop", async () => {
    const { chat, prompts } = harness(
      [() => done("plan a"), () => done("plan b"), () => done("plan c")],
      true,
    );
    chat.send("plan this");
    await settle(chat);
    expect(prompts).toHaveLength(2);
  });

  test("build mode is never nudged", async () => {
    const { chat, prompts } = harness([() => done("done")], false);
    chat.send("do this");
    await settle(chat);
    expect(prompts).toHaveLength(1);
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

describe("keeping a subagent's tools out of the transcript", () => {
  const toolEvent = (over: Partial<ToolEvent> = {}): ToolEvent =>
    ({ id: 1, name: "read", detail: "a.ts", phase: "end", ok: true, ...over }) as ToolEvent;

  const drive = async (events: ToolEvent[]) => {
    const seen: SessionEvent[] = [];
    const signalled: ChatSignal[] = [];
    const agent = {
      mode: () => DEFAULT_MODE,
      setMode: () => {},
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

  test("a subagent's own call never reaches the transcript", async () => {
    const { seen } = await drive([
      toolEvent({ id: 7, name: "grep", phase: "start", origin: 3 } as Partial<ToolEvent>),
      toolEvent({ id: 7, name: "grep", origin: 3 }),
    ]);
    expect(seen.filter((event) => event.type === "tool")).toHaveLength(0);
  });

  test("but it is still signalled, so the live view can show it", async () => {
    const { signalled } = await drive([toolEvent({ id: 7, name: "grep", origin: 3 })]);
    expect(signalled.filter((value) => value.type === "tool")).toHaveLength(1);
  });

  test("the parent's own calls are unaffected", async () => {
    const { seen } = await drive([
      toolEvent({ id: 1, name: "read", phase: "start" } as Partial<ToolEvent>),
      toolEvent({ id: 1, name: "read" }),
    ]);
    expect(seen.filter((event) => event.type === "tool")).toHaveLength(1);
  });

  test("the run_subagent row itself stays, since it is the parent's call", async () => {
    const { seen } = await drive([
      toolEvent({
        id: 3,
        name: "run_subagent",
        detail: "audit",
        phase: "start",
      } as Partial<ToolEvent>),
      toolEvent({ id: 3, name: "run_subagent", detail: "audit" }),
    ]);
    expect(seen.filter((event) => event.type === "tool")).toMatchObject([{ name: "run_subagent" }]);
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
      mode: () => DEFAULT_MODE,
      setMode: () => {},
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
