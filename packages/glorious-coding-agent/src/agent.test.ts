import { describe, expect, test } from "bun:test";
import { providerOptions, settleQuietly, shouldResend, worthRetrying } from "./agent";
import { errorText } from "./render";

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
    process.stdout.write(String(strays.length));
  `;
  // NO_COLOR, and the ANSI strip below, because this parses the child's stdout
  // as a number. With FORCE_COLOR set in the parent — which a terminal or a
  // CI wrapper may well do — Bun wraps even a bare number in colour codes, and
  // Number("\x1b[33m3\x1b[0m") is NaN. The test then fails for a reason that
  // has nothing to do with what it is testing.
  const run = Bun.spawn(["bun", "-e", program], {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  // Built rather than written as a literal: an escape character inside a regex
  // literal is a lint error, and the point here is to tolerate one in the input.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");
  const said = (await new Response(run.stdout).text()).replace(ansi, "").trim();
  return Number(said);
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

describe("what we ask the provider for", () => {
  test("reasoning travels as content, never as a server-side reference", () => {
    // store:true (the provider's default when unset) replays reasoning as
    // {type:"item_reference", id:"rs_…"}, and a missed lookup kills the turn
    expect(providerOptions(undefined, "key").store).toBe(false);
  });

  test("the cache key still rides along, so prompt caching is unaffected", () => {
    expect(providerOptions(undefined, "abc123").promptCacheKey).toBe("abc123");
  });

  test("effort is sent only when a mode asked for one", () => {
    expect(providerOptions("high", "k")).toMatchObject({ reasoningEffort: "high" });
    expect(providerOptions(undefined, "k")).not.toHaveProperty("reasoningEffort");
  });
});

// A dropped connection is reported by Bun as a plain Error whose only signal is
// `code` — name is "Error". Matching on name alone made "The socket connection
// was closed unexpectedly" look permanent, so a single blip killed the turn
// instead of being retried. That is the failure a retry exists for.
describe("which failures are worth retrying", () => {
  const withCode = (code: string): Error =>
    Object.assign(new Error("The socket connection was closed unexpectedly."), { code });

  test("a dropped connection, as Bun actually reports it", () => {
    const dropped = withCode("ECONNRESET");
    expect(dropped.name).toBe("Error");
    expect(worthRetrying(dropped)).toBe(true);
  });

  test("the rest of the transient transport family", () => {
    for (const code of ["ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ENETDOWN", "EAI_AGAIN"])
      expect(worthRetrying(withCode(code))).toBe(true);
  });

  test("names still match, so the original cases keep working", () => {
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    expect(worthRetrying(timeout)).toBe(true);
    expect(worthRetrying(new TypeError("fetch failed"))).toBe(true);
  });

  // A hostname that does not exist will not start existing on attempt three.
  test("a permanent failure is not retried", () => {
    expect(worthRetrying(withCode("ENOTFOUND"))).toBe(false);
    expect(worthRetrying(new Error("401 Unauthorized"))).toBe(false);
    expect(worthRetrying("not an error")).toBe(false);
  });
});

describe("what the user is told when the connection drops", () => {
  test("the Bun message is replaced with one that means something", () => {
    const said = errorText(
      new Error(
        "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
      ),
    );
    expect(said).not.toContain("verbose: true");
    expect(said).not.toContain("second argument");
    expect(said).toContain("dropped mid-response");
    expect(said).toContain("continue");
  });

  test("an ordinary message is passed through untouched", () => {
    expect(errorText(new Error("old_string not found"))).toBe("old_string not found");
  });
});

// Reported from a live session, twice in a row: a long turn died with "the
// connection to the model dropped mid-response" after eleven tool calls, and
// every one of them was thrown away. The existing retry could not see it —
// fetchWithDeadline retries while the request is being made, and a mid-response
// drop happens long after fetch() resolved, while the body is being read.
describe("a dropped stream", () => {
  const dropped = (): Error => {
    const failure = new Error("The socket connection was closed unexpectedly");
    (failure as Error & { code?: string }).code = "ECONNRESET";
    return failure;
  };

  test("a drop before anything is produced is worth re-sending", () => {
    expect(worthRetrying(dropped())).toBe(true);
  });

  test("a refusal is not", () => {
    expect(worthRetrying(new Error("401 Unauthorized"))).toBe(false);
  });

  test("a name that does not resolve is not retried; a lookup that failed is", () => {
    const gone = new Error("getaddrinfo ENOTFOUND");
    (gone as Error & { code?: string }).code = "ENOTFOUND";
    expect(worthRetrying(gone)).toBe(false);
    const flaky = new Error("getaddrinfo EAI_AGAIN");
    (flaky as Error & { code?: string }).code = "EAI_AGAIN";
    expect(worthRetrying(flaky)).toBe(true);
  });

  // The rule the retry turns on: re-sending is safe exactly while the attempt
  // is unobservable. A tool call has side effects, so once one has run the turn
  // cannot start over.
  test("the message names what the user should do when it cannot be re-sent", () => {
    expect(errorText(dropped())).toContain("continue");
  });
});

describe("when a dropped stream may be sent again", () => {
  const dropped = () => {
    const failure = new Error("The socket connection was closed unexpectedly");
    (failure as Error & { code?: string }).code = "ECONNRESET";
    return failure;
  };
  const state = (over: Partial<Parameters<typeof shouldResend>[0]> = {}) => ({
    produced: false,
    aborted: false,
    attempt: 1,
    attempts: 3,
    failure: dropped(),
    ...over,
  });

  test("nothing was shown yet, so it can simply happen again", () => {
    expect(shouldResend(state())).toBe(true);
  });

  // A tool call has side effects. Re-sending would run it twice.
  test("once anything has been produced, the turn cannot start over", () => {
    expect(shouldResend(state({ produced: true }))).toBe(false);
  });

  test("Esc means stop, not try harder", () => {
    expect(shouldResend(state({ aborted: true }))).toBe(false);
  });

  test("it gives up rather than retrying forever", () => {
    expect(shouldResend(state({ attempt: 3 }))).toBe(true);
    expect(shouldResend(state({ attempt: 4 }))).toBe(false);
  });

  test("a refusal is not a dropped connection", () => {
    expect(shouldResend(state({ failure: new Error("401 Unauthorized") }))).toBe(false);
  });
});
