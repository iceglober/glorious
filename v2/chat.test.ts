import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import type { Agent } from "./agent";
import { createChat } from "./chat";
import type { SessionEvent } from "./events";
import { DEFAULT_MODE, type Mode } from "./modes";
import { REMINDER_CLOSE, REMINDER_OPEN } from "./prompt";

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
