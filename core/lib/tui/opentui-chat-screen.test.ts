import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { ChatScreenCallbacks } from "./chat-screen-types";
import {
  type CreateOpenTuiChatScreenOptions,
  createOpenTuiChatScreen,
} from "./opentui-chat-screen";

type Overrides = Partial<Omit<CreateOpenTuiChatScreenOptions, "callbacks">> & {
  callbacks?: Partial<ChatScreenCallbacks>;
};

const setup = async (overrides: Overrides = {}) => {
  const harness = await createTestRenderer({
    width: 80,
    height: 24,
    screenMode: "alternate-screen",
    // The real screen owns its renderer with exitOnCtrlC:false so Ctrl+C reaches
    // the key handler; mirror that for the injected test renderer.
    exitOnCtrlC: false,
  });
  const submitted: string[] = [];
  const escapes: number[] = [];
  const quits: number[] = [];
  const { callbacks: callbackOverrides, ...rest } = overrides;
  const screen = await createOpenTuiChatScreen({
    renderer: harness.renderer,
    color: false,
    ...rest,
    callbacks: {
      onSubmit: (text) => submitted.push(text),
      onEscape: () => escapes.push(1),
      onQuit: () => quits.push(1),
      ...callbackOverrides,
    },
  });
  return { ...harness, screen, submitted, escapes, quits };
};

const waitUntil = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** Trailing whitespace is padding, not content — strip it before matching rows. */
const rows = (frame: string): string[] =>
  frame.split("\n").map((line) => line.replace(/\s+$/u, ""));

/** The composer's default placeholder, i.e. what an empty composer paints. */
const EMPTY_COMPOSER = "Ask Glorious anything";

describe("createOpenTuiChatScreen", () => {
  test("start and stop run without throwing", async () => {
    const { renderer, screen } = await setup();
    expect(() => screen.start()).not.toThrow();
    expect(() => screen.stop()).not.toThrow();
    renderer.destroy();
  });

  test("printAbove renders a transcript block", async () => {
    const { renderer, screen, renderOnce, captureCharFrame } = await setup();
    screen.start();
    screen.printAbove([[{ text: "hello transcript" }]]);
    await renderOnce();
    expect(captureCharFrame()).toContain("hello transcript");
    screen.stop();
    renderer.destroy();
  });

  test("transcript printed before start is replayed once the UI exists", async () => {
    const { renderer, screen, renderOnce, captureCharFrame } = await setup();
    // Queued with no UI to paint into...
    screen.printAbove([[{ text: "queued before start" }]], "turn");
    screen.start();
    await renderOnce();
    // ...and replayed when start() builds the transcript box.
    expect(captureCharFrame()).toContain("queued before start");
    screen.stop();
    renderer.destroy();
  });

  test("clearTranscript empties the transcript and the live sections", async () => {
    const { renderer, screen, renderOnce, captureCharFrame } = await setup();
    screen.start();
    screen.printAbove([[{ text: "old turn" }]]);
    screen.setProgressLines([[{ text: "running something" }]]);
    screen.setStatusLines([[{ text: "status footer" }]]);
    await renderOnce();
    expect(captureCharFrame()).toContain("old turn");

    screen.clearTranscript();
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).not.toContain("old turn");
    expect(frame).not.toContain("running something");
    expect(frame).not.toContain("status footer");
    screen.stop();
    renderer.destroy();
  });

  test("setStatusLines and setProgressLines update the surface", async () => {
    const { renderer, screen, renderOnce, captureCharFrame } = await setup();
    screen.start();
    screen.setStatusLines([[{ text: "status footer" }]]);
    screen.setProgressLines([[{ text: "█████ bash ls" }]]);
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("status footer");
    expect(frame).toContain("bash ls");
    screen.stop();
    renderer.destroy();
  });

  test("repainting identical progress or status lines is skipped", async () => {
    const { renderer, screen } = await setup();
    screen.start();
    // Count repaint requests to prove the dedup keys, not just the visible frame.
    let renders = 0;
    const requestRender = renderer.requestRender.bind(renderer);
    renderer.requestRender = () => {
      renders += 1;
      requestRender();
    };

    screen.setStatusLines([[{ text: "~/repo · model · ctx 0" }]]);
    const afterStatus = renders;
    expect(afterStatus).toBeGreaterThan(0);
    screen.setStatusLines([[{ text: "~/repo · model · ctx 0" }]]); // identical → no repaint
    expect(renders).toBe(afterStatus);
    screen.setStatusLines([[{ text: "~/repo · model · ctx 1" }]]);
    expect(renders).toBeGreaterThan(afterStatus);

    const beforeProgress = renders;
    screen.setProgressLines([[{ text: "█████ bash ls" }]]);
    const afterProgress = renders;
    expect(afterProgress).toBeGreaterThan(beforeProgress);
    screen.setProgressLines([[{ text: "█████ bash ls" }]]); // identical → no repaint
    expect(renders).toBe(afterProgress);

    screen.stop();
    renderer.destroy();
  });

  test("a submitted line fires onSubmit and clears the composer", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, submitted } = await setup();
    // Start the renderer so mock keystrokes reach the focused composer.
    renderer.start();
    screen.start();
    await mockInput.typeText("hi there");
    await renderOnce();
    mockInput.pressEnter();
    await waitUntil(() => submitted.length > 0);
    expect(submitted).toEqual(["hi there"]);
    await renderOnce();
    expect(captureCharFrame()).not.toContain("hi there");
    screen.stop();
    renderer.destroy();
  });

  test("a blank composer submits nothing", async () => {
    const { renderer, screen, mockInput, renderOnce, submitted } = await setup();
    renderer.start();
    screen.start();
    await mockInput.typeText("   ");
    await renderOnce();
    mockInput.pressEnter();
    await renderOnce();
    expect(submitted).toEqual([]);
    screen.stop();
    renderer.destroy();
  });

  test("submit expands an oversized paste back to its full content", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, submitted } = await setup();
    renderer.start();
    screen.start();
    const pasted = "x".repeat(1_200);
    await mockInput.pasteBracketedText(pasted);
    await renderOnce();
    // The composer holds a short placeholder, not 1200 characters of noise.
    const frame = captureCharFrame();
    expect(frame).toContain("[pasted content #1: 1200 chars]");
    expect(frame).not.toContain("x".repeat(200));

    await mockInput.typeText(" summarize this");
    await renderOnce();
    mockInput.pressEnter();
    await waitUntil(() => submitted.length > 0);
    expect(submitted).toEqual([`${pasted} summarize this`]);
    screen.stop();
    renderer.destroy();
  });

  test("a small paste is inserted inline, with no placeholder", async () => {
    const { renderer, screen, mockInput, renderOnce, submitted } = await setup();
    renderer.start();
    screen.start();
    await mockInput.pasteBracketedText("two\nlines");
    await renderOnce();
    mockInput.pressEnter();
    await waitUntil(() => submitted.length > 0);
    expect(submitted).toEqual(["two\nlines"]);
    screen.stop();
    renderer.destroy();
  });

  test("a submitted line joins the history it can be recalled from", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, submitted } = await setup();
    renderer.start();
    screen.start();
    await mockInput.typeText("remember me");
    mockInput.pressEnter();
    await waitUntil(() => submitted.length > 0);
    await renderOnce();

    mockInput.pressArrow("up");
    await renderOnce();
    expect(captureCharFrame()).toContain("remember me");
    screen.stop();
    renderer.destroy();
  });

  test("Up recalls the most recent prompt first", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame } = await setup({
      initialHistory: ["older prompt", "newer prompt"],
    });
    renderer.start();
    screen.start();
    await renderOnce();

    mockInput.pressArrow("up");
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("newer prompt");
    expect(frame).not.toContain("older prompt");
    screen.stop();
    renderer.destroy();
  });

  /**
   * Drive one uninterrupted burst of browse keys and read back the composer row.
   * The presses are not separated by a repaint on purpose: OpenTUI dispatches the
   * textarea's content-change callback on a microtask, so a render between two
   * presses clears the browse position (`setComposerText`'s `suppressContentReset`
   * is already back to false by the time the callback runs).
   */
  const browse = async (
    keys: Array<"up" | "down" | "ctrl-p" | "ctrl-n">,
    history: string[] = ["older prompt", "newer prompt"],
  ): Promise<string> => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame } = await setup({
      initialHistory: history,
    });
    renderer.start();
    screen.start();
    await renderOnce();
    for (const key of keys) {
      if (key === "up" || key === "down") mockInput.pressArrow(key);
      else mockInput.pressKey(key === "ctrl-p" ? "p" : "n", { ctrl: true });
    }
    await renderOnce();
    const row = rows(captureCharFrame()).find((line) => line.startsWith("›")) ?? "";
    screen.stop();
    renderer.destroy();
    // An empty composer shows its placeholder; report that as "".
    const text = row.replace("›", "").trim();
    return text === EMPTY_COMPOSER ? "" : text;
  };

  test("Up and Down walk the seeded history and back to a blank composer", async () => {
    expect(await browse(["up"])).toBe("newer prompt");
    expect(await browse(["up", "up"])).toBe("older prompt");
    expect(await browse(["up", "up", "up"])).toBe("older prompt"); // clamped at the oldest
    expect(await browse(["up", "up", "down"])).toBe("newer prompt");
    expect(await browse(["up", "down"])).toBe(""); // past the newest → blank again
  });

  test("Ctrl+P and Ctrl+N browse history like the arrows", async () => {
    expect(await browse(["ctrl-p", "ctrl-p"])).toBe("older prompt");
    expect(await browse(["ctrl-p", "ctrl-p", "ctrl-n"])).toBe("newer prompt");
  });

  test("Down on an untouched composer does nothing", async () => {
    expect(await browse(["down"])).toBe("");
    expect(await browse(["down", "down"])).toBe("");
  });

  test("blank history entries are dropped, leaving nothing to browse", async () => {
    expect(await browse(["up"], ["   ", ""])).toBe("");
  });

  test("restoreInput puts the recovered prompt ahead of the current draft", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame } = await setup();
    renderer.start();
    screen.start();
    await mockInput.typeText("half-written draft");
    await renderOnce();

    screen.restoreInput("dequeued prompt");
    await renderOnce();
    const lines = rows(captureCharFrame()).filter((line) => line.length > 0);
    const restored = lines.findIndex((line) => line.includes("dequeued prompt"));
    const draft = lines.findIndex((line) => line.includes("half-written draft"));
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(draft).toBeGreaterThan(restored);
    screen.stop();
    renderer.destroy();
  });

  test("Escape asks the session to interrupt", async () => {
    const { renderer, screen, mockInput, renderOnce, escapes } = await setup();
    renderer.start();
    screen.start();
    mockInput.pressEscape();
    await waitUntil(() => escapes.length > 0);
    expect(escapes).toHaveLength(1);
    await renderOnce();
    screen.stop();
    renderer.destroy();
  });

  test("Ctrl+C on a non-empty composer only clears the draft", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, quits, escapes } =
      await setup();
    renderer.start();
    screen.start();
    await mockInput.typeText("throwaway draft");
    await renderOnce();

    mockInput.pressCtrlC();
    await waitUntil(() => !captureCharFrame().includes("throwaway draft"));
    const frame = captureCharFrame();
    expect(frame).not.toContain("throwaway draft");
    expect(frame).not.toContain("Ctrl+C again to exit"); // clearing does not arm the quit
    expect(quits).toHaveLength(0);
    expect(escapes).toHaveLength(0);
    screen.stop();
    renderer.destroy();
  });

  test("first Ctrl+C shows an 'again to exit' hint, dismissed by another key", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, quits, escapes } =
      await setup();
    renderer.start();
    screen.start();
    screen.setStatusLines([[{ text: "~/repo · model · ctx 0" }]]);
    await renderOnce();

    mockInput.pressCtrlC(); // empty composer → arm + hint, and interrupt the turn
    await waitUntil(() => captureCharFrame().includes("Ctrl+C again to exit"));
    expect(captureCharFrame()).toContain("Ctrl+C again to exit");
    expect(escapes).toHaveLength(1); // the same press interrupts a running turn
    expect(quits).toHaveLength(0); // one press does not quit

    await mockInput.typeText("x"); // any other key breaks the sequence
    await renderOnce();
    expect(captureCharFrame()).not.toContain("Ctrl+C again to exit");
    expect(quits).toHaveLength(0);
    screen.stop();
    renderer.destroy();
  });

  test("a second Ctrl+C inside the window quits", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, quits } = await setup();
    renderer.start();
    screen.start();
    await renderOnce();

    mockInput.pressCtrlC();
    await waitUntil(() => captureCharFrame().includes("Ctrl+C again to exit"));
    mockInput.pressCtrlC();
    await waitUntil(() => quits.length > 0);
    expect(quits).toHaveLength(1);
    screen.stop();
    renderer.destroy();
  });

  test("the quit hint times out, so a later Ctrl+C only re-arms", async () => {
    const { renderer, screen, mockInput, renderOnce, captureCharFrame, quits } = await setup({
      quitWindowMs: 30,
    });
    renderer.start();
    screen.start();
    await renderOnce();

    mockInput.pressCtrlC();
    await waitUntil(() => captureCharFrame().includes("Ctrl+C again to exit"));
    await waitUntil(() => !captureCharFrame().includes("Ctrl+C again to exit"));
    expect(captureCharFrame()).not.toContain("Ctrl+C again to exit");

    mockInput.pressCtrlC(); // window elapsed → arms again instead of quitting
    await waitUntil(() => captureCharFrame().includes("Ctrl+C again to exit"));
    expect(quits).toHaveLength(0);
    screen.stop();
    renderer.destroy();
  });

  test("setComposer swaps the label and the empty-state placeholder", async () => {
    const { renderer, screen, renderOnce, captureCharFrame } = await setup();
    screen.start();
    screen.setComposer({ label: "» ", placeholder: "Describe the task" });
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("»");
    expect(frame).toContain("Describe the task");
    screen.stop();
    renderer.destroy();
  });

  test("copies a highlighted selection to the system clipboard", async () => {
    const { renderer, screen } = await setup();
    const copied: string[] = [];
    const spy = renderer as unknown as {
      copyToClipboardOSC52: (t: string) => boolean;
      emit: (event: string, ...args: unknown[]) => void;
    };
    spy.copyToClipboardOSC52 = (t) => {
      copied.push(t);
      return true;
    };
    screen.start();
    // OpenTUI draws the highlight and emits "selection"; the adapter copies it.
    spy.emit("selection", { getSelectedText: () => "grab me" });
    spy.emit("selection", { getSelectedText: () => "" }); // empty selection is ignored
    expect(copied).toEqual(["grab me"]);
    screen.stop();
    renderer.destroy();
  });

  test("width reports the usable line width", async () => {
    const { renderer, screen } = await setup();
    screen.start();
    expect(screen.width()).toBe(79);
    screen.stop();
    renderer.destroy();
  });
});
