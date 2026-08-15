import { describe, expect, test } from "bun:test";
import { settleQuietly } from "./agent";

describe("settleQuietly", () => {
  test("passes a resolved value straight through", async () => {
    expect(await settleQuietly(Promise.resolve("real"), "fallback")).toBe("real");
  });

  test("substitutes the fallback rather than rejecting", async () => {
    expect(await settleQuietly(Promise.reject(new Error("no")), "fallback")).toBe("fallback");
  });

  test("the failure still travels by its own route", async () => {
    // settleQuietly silences the promise, not the stream: the iteration below is
    // what reports the failure, and it must still do so.
    const boom = new Error("provider blew up");
    const stream = (async function* () {
      yield "partial";
      throw boom;
    })();
    settleQuietly(Promise.reject(boom), "");
    let thrown: unknown;
    try {
      for await (const piece of stream) void piece;
    } catch (bad) {
      thrown = bad;
    }
    expect((thrown as Error)?.message).toBe("provider blew up");
  });
});

// Counted in a fresh process: bun's runner installs its own handler, so an
// unhandled rejection is not observable from inside a test.
const countStrays = async (mode: "before" | "after"): Promise<number> => {
  const program = `
    const strays = [];
    process.on("unhandledRejection", (r) => strays.push(r));
    const boom = new Error("provider blew up");
    const fake = {
      stream: (async function* () { yield "partial"; throw boom; })(),
      text: Promise.reject(boom),
      messages: Promise.reject(boom),
      steps: Promise.reject(boom),
    };
    try {
      if ("${mode}" === "after") {
        const settled = [
          Promise.resolve(fake.text).catch(() => ""),
          Promise.resolve(fake.messages).catch(() => []),
          Promise.resolve(fake.steps).catch(() => []),
        ];
        for await (const p of fake.stream) void p;
        await Promise.all(settled);
      } else {
        for await (const p of fake.stream) void p;
        await Promise.all([fake.text, fake.messages, fake.steps]);
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 60));
    console.log(strays.length);
  `;
  const run = Bun.spawn(["bun", "-e", program], { stdout: "pipe", stderr: "ignore" });
  return Number((await new Response(run.stdout).text()).trim());
};

describe("a stream that fails part-way", () => {
  test("awaiting only after iterating strands every sibling promise", async () => {
    // three stray rejections, which Bun prints to stderr over the TUI — this is
    // exactly what shredded the screen
    expect(await countStrays("before")).toBe(3);
  });

  test("subscribing first strands none", async () => {
    expect(await countStrays("after")).toBe(0);
  });
});
