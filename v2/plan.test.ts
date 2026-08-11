import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { allowedTools } from "./agent";
import { messagesOf, type SessionEvent } from "./events";
import { type Mode, modeByName } from "./modes";
import { PLAN_FEEDBACK, PLAN_FRESH, PLAN_KEEP, PLAN_OPTIONS, planBlock, planVerdict } from "./plan";
import { implementPrompt, modePrompt, planNudge } from "./prompt";
import { BUILT_IN_TOOL_NAMES, PLAN_ONLY_TOOL_NAMES } from "./tools";

const answer = (option: string | null, note = ""): string =>
  JSON.stringify({ answers: [{ question: "Ready to implement?", option, note }] });

describe("reading the user's verdict", () => {
  test("fresh and keep both approve, and differ only in the clear", () => {
    expect(planVerdict(answer(PLAN_FRESH))).toEqual({ decision: "approved", fresh: true });
    expect(planVerdict(answer(PLAN_KEEP))).toEqual({ decision: "approved", fresh: false });
  });

  test("Esc cancels, and cancelling is not approval", () => {
    expect(planVerdict(JSON.stringify({ cancelled: true }))).toEqual({ decision: "cancelled" });
  });

  test("a note typed without touching the options is feedback, never approval", () => {
    // the widget reports option: null in that case, and guessing "approved"
    // here is the one mistake in this flow that cannot be undone
    expect(planVerdict(answer(null, "use a map instead"))).toEqual({
      decision: "feedback",
      note: "use a map instead",
    });
  });

  test("choosing feedback with no note still asks, rather than proceeding", () => {
    expect(planVerdict(answer(PLAN_FEEDBACK))).toEqual({ decision: "feedback", note: "" });
  });

  test("a note alongside approval does not turn it into feedback", () => {
    expect(planVerdict(answer(PLAN_FRESH, "looks right"))).toEqual({
      decision: "approved",
      fresh: true,
    });
  });

  test("garbage and empty replies cancel instead of throwing", () => {
    expect(planVerdict("not json")).toEqual({ decision: "cancelled" });
    expect(planVerdict(JSON.stringify({ answers: [] }))).toEqual({ decision: "cancelled" });
  });

  test("the parsed labels are the ones actually shown", () => {
    for (const option of PLAN_OPTIONS) expect(planVerdict(answer(option)).decision).not.toBe("");
    expect(PLAN_OPTIONS).toHaveLength(3);
  });
});

describe("clearing context", () => {
  const turn = (text: string): SessionEvent => ({
    type: "turn",
    messages: [{ role: "assistant", content: text } as ModelMessage],
  });

  test("the fold restarts at the clear, so a resumed session matches the live one", () => {
    const events: SessionEvent[] = [
      turn("before"),
      { type: "cleared", reason: "plan approved" },
      turn("after"),
    ];
    expect(messagesOf(events)).toHaveLength(1);
    expect(messagesOf(events)[0].content).toBe("after");
  });

  test("only the last clear counts, so a second plan does not resurrect the first", () => {
    const events: SessionEvent[] = [
      turn("a"),
      { type: "cleared", reason: "plan approved" },
      turn("b"),
      { type: "cleared", reason: "plan approved" },
      turn("c"),
    ];
    expect(messagesOf(events).map((message) => message.content)).toEqual(["c"]);
  });

  test("the transcript keeps everything a clear removed from the model's view", () => {
    const events: SessionEvent[] = [
      { type: "user", text: "the original ask" },
      turn("before"),
      { type: "cleared", reason: "plan approved" },
    ];
    // the user's scrollback is the event list itself, not the fold
    expect(events.filter((event) => event.type === "user")).toHaveLength(1);
    expect(messagesOf(events)).toHaveLength(0);
  });

  test("a session with no clear folds exactly as before", () => {
    expect(messagesOf([turn("a"), turn("b")])).toHaveLength(2);
  });
});

describe("what carries across the clear", () => {
  test("the plan, the files it named, and the request that prompted it", () => {
    const prompt = implementPrompt("step one", ["v2/agent.ts"], "make it faster");
    expect(prompt).toContain("step one");
    expect(prompt).toContain("v2/agent.ts");
    expect(prompt).toContain("make it faster");
  });

  test("it tells the model the mode already changed, so it does not ask again", () => {
    expect(implementPrompt("p", [], "a")).toContain("build mode");
  });

  test("no files and no recorded request still yields a usable instruction", () => {
    const prompt = implementPrompt("step one", [], "");
    expect(prompt).toContain("step one");
    expect(prompt).not.toContain("<plan-files>");
    expect(prompt).not.toContain("<request>");
  });

  test("the plan shown to the user lists the files it depends on", () => {
    expect(planBlock("do the thing", ["a.ts", "b.ts"])).toContain("a.ts");
    expect(planBlock("do the thing", [])).toBe("do the thing");
  });
});

describe("who gets present_plan", () => {
  const every = { read: 1, write: 1, bash: 1, present_plan: 1 };

  test("plan mode has it, since that is how a plan reaches the user", () => {
    expect(Object.keys(allowedTools(every, modeByName("plan") as Mode, []))).toContain(
      "present_plan",
    );
  });

  test("build mode does not, since there is nothing to approve", () => {
    expect(Object.keys(allowedTools(every, modeByName("build") as Mode, []))).not.toContain(
      "present_plan",
    );
  });

  test("build mode still keeps everything else", () => {
    const kept = Object.keys(allowedTools(every, modeByName("build") as Mode, []));
    expect(kept).toEqual(["read", "write", "bash"]);
  });

  test("it is a real tool name", () => {
    for (const name of PLAN_ONLY_TOOL_NAMES)
      expect(BUILT_IN_TOOL_NAMES as readonly string[]).toContain(name);
  });
});

describe("what plan mode is told", () => {
  test("it is required to end by presenting, not merely invited to", () => {
    expect(modePrompt({ name: "plan", readOnly: true })).toContain("present_plan");
  });

  test("it is warned the plan must stand alone, because approval may clear context", () => {
    expect(modePrompt({ name: "plan", readOnly: true })).toMatch(/stand on its own/u);
  });

  test("the nudge is a system-reminder, not something the user appears to have said", () => {
    expect(planNudge).toContain("system-reminder");
    expect(planNudge).toContain("present_plan");
  });
});
