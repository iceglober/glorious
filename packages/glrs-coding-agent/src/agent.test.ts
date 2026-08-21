import { describe, expect, test } from "bun:test";
import { generateText, type ModelMessage, type ToolSet, tool } from "ai";
import { z } from "zod";
import { createModel, type ModelOption } from "../../provider-registry/src";
import {
  createAgent,
  providerOptions,
  requestSettings,
  routeProviderWarnings,
  settleQuietly,
  shouldResend,
  terminatingToolCalled,
  withInjected,
  worthRetrying,
} from "./agent";
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
  const model = (over: Record<string, unknown> = {}) => ({
    provider: "openai",
    modelId: "gpt-5",
    name: "gpt-5",
    env: [],
    ...over,
  });

  test("OpenAI safety and caching defaults are namespaced as provider options", () => {
    expect(providerOptions(model(), "abc123")).toEqual({
      openai: {
        textVerbosity: "low",
        promptCacheKey: "abc123",
        store: false,
      },
    });
  });

  test("configured provider options pass through and override defaults", () => {
    expect(
      providerOptions(
        model({
          variant: "high",
          providerOptions: {
            openai: { store: true, customFutureOption: "kept" },
            gateway: { order: ["bedrock"] },
          },
        }),
        "key",
      ),
    ).toEqual({
      openai: {
        reasoningEffort: "high",
        textVerbosity: "low",
        promptCacheKey: "key",
        store: true,
        customFutureOption: "kept",
      },
      gateway: { order: ["bedrock"] },
    });
  });

  test("non-OpenAI models do not receive OpenAI-only defaults", () => {
    expect(
      providerOptions(
        model({
          provider: "anthropic",
          providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
        }),
        "key",
      ),
    ).toEqual({ anthropic: { thinking: { type: "adaptive" } } });
  });

  test("common request options and provider options are assembled together", () => {
    expect(
      requestSettings(
        model({
          requestOptions: { temperature: 0.2, maxOutputTokens: 32000, maxRetries: 9 },
          providerOptions: { openai: { serviceTier: "flex" } },
        }),
        "key",
      ),
    ).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 32000,
      maxRetries: 9,
      providerOptions: { openai: { serviceTier: "flex", store: false } },
    });
  });

  test("request and provider options reach the provider HTTP body", async () => {
    let body: Record<string, unknown> = {};
    const selected: ModelOption = {
      provider: "openai",
      modelId: "gpt-4.1",
      name: "gpt-4.1",
      env: [],
      factoryOptions: { apiKey: "test-key" },
      requestOptions: { temperature: 0.2 },
      providerOptions: { openai: { serviceTier: "default", store: true } },
    };
    const languageModel = createModel(selected, (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 500 });
    }) as typeof fetch);
    await generateText({
      model: languageModel,
      prompt: "hi",
      maxRetries: 0,
      ...requestSettings(selected, "key"),
    }).catch(() => {});
    expect(body.temperature).toBe(0.2);
    expect(body.service_tier).toBe("default");
    expect(body.store).toBe(true);
  });
});

// A dropped connection is reported by Bun as a plain Error whose only signal is
// `code` — name is "Error". Matching on name alone made "The socket connection
// was closed unexpectedly" look permanent, so a single blip killed the turn
// instead of being retried. That is the failure a retry exists for.
describe("terminating extension tools", () => {
  test("the active turn stops after a named tool call", () => {
    expect(
      terminatingToolCalled([{ toolCalls: [{ toolName: "final" }] }], new Set(["final"])),
    ).toBe(true);
    expect(terminatingToolCalled([{ toolCalls: [{ toolName: "read" }] }], new Set(["final"]))).toBe(
      false,
    );
  });
});

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

// A tool filter is a predicate, and it is applied per model call rather than
// resolved once into a list of names. That distinction is the whole of the bug
// this covers: the resolved list was computed at the moment a filter was
// registered, so a tool belonging to an extension that had not loaded yet was
// simply absent from it and stayed withheld for the session. Which tools the
// model could see depended on extension load order.
describe("which tools a filter withholds", () => {
  const named = (...names: string[]): ToolSet =>
    Object.fromEntries(
      names.map((name) => [
        name,
        tool({ description: name, inputSchema: z.object({}), execute: async () => name }),
      ]),
    );

  // Every tool now arrives through the registry, including the six that touch
  // the machine — they are the builtins extension. So a test about filtering
  // supplies its own rather than leaning on what the agent happens to build.
  const nothing = (): ToolSet => named("read", "write", "bash");

  const build = (extensionTools: () => ToolSet = nothing) =>
    createAgent({
      root: "/tmp",
      model: { name: "test", provider: "azure", modelId: "test", env: [] },
      sessionId: "filters",
      rules: "",
      cwd: "/tmp",
      os: "darwin",
      date: "2026-08-18",
      git: "",
      skills: "",
      skillTools: { catalog: "", commands: [], summaries: [], warnings: [], tool: undefined },
      extensionTools,
    });

  const greet = (): ToolSet => ({
    greet: tool({
      description: "say hello",
      inputSchema: z.object({}),
      execute: async () => "hello",
    }),
  });

  test("with no filters at all, everything survives", () => {
    expect(build().toolNames()).toContain("write");
  });

  test("the agent registers no tools of its own beyond activate_skill", () => {
    // The six moved to an extension. Handed nothing, the agent has nothing —
    // which is the claim "the core registers no tools of its own" makes.
    const bare = createAgent({
      root: "/tmp",
      model: { name: "test", provider: "azure", modelId: "test", env: [] },
      sessionId: "bare",
      rules: "",
      cwd: "/tmp",
      os: "darwin",
      date: "2026-08-18",
      git: "",
      skills: "",
      skillTools: { catalog: "", commands: [], summaries: [], warnings: [], tool: undefined },
    });
    expect(bare.toolNames()).toEqual([]);
  });

  test("a filter withholds what it refuses", () => {
    const agent = build();
    agent.setToolFilters([(name) => name !== "write"]);
    expect(agent.toolNames()).not.toContain("write");
    expect(agent.toolNames()).toContain("read");
  });

  // The one that was broken. The filter is registered while the extension
  // supplying `greet` has not loaded; `greet` appears afterwards.
  test("a tool that arrives after the filter is still judged by it", () => {
    let extra: ToolSet = named("read", "write", "bash");
    const agent = build(() => extra);
    agent.setToolFilters([(name) => name !== "write"]);
    extra = { ...named("read", "write", "bash"), ...greet() };
    expect(agent.toolNames()).toContain("greet");
    expect(agent.toolNames()).not.toContain("write");
  });

  test("a later tool the filter refuses is still refused", () => {
    let extra: ToolSet = named("read", "write", "bash");
    const agent = build(() => extra);
    agent.setToolFilters([(name) => name !== "greet"]);
    extra = { ...named("read", "write", "bash"), ...greet() };
    expect(agent.toolNames()).not.toContain("greet");
    expect(agent.toolNames()).toContain("read");
  });

  // Every filter has to agree, so a restriction can only ever narrow and no
  // extension has to know what else is installed.
  test("filters intersect rather than the last one winning", () => {
    const agent = build();
    agent.setToolFilters([(name) => name !== "write", (name) => name !== "bash"]);
    const names = agent.toolNames();
    expect(names).not.toContain("write");
    expect(names).not.toContain("bash");
    expect(names).toContain("read");
  });

  test("clearing the filters brings everything back", () => {
    const agent = build();
    agent.setToolFilters([() => false]);
    expect(agent.toolNames()).toEqual([]);
    agent.setToolFilters([]);
    expect(agent.toolNames()).toContain("write");
  });
});

// A steering message is appended to what the model sees at a step boundary, so
// it is in neither the messages that were sent nor the ones that came back.
// Putting it at the end of the record instead would have the assistant answer
// something the stored conversation never says was asked.
describe("where a steering message lands in the turn's record", () => {
  const say = (role: "assistant" | "user", content: string): ModelMessage =>
    ({ role, content }) as ModelMessage;
  const texts = (messages: readonly ModelMessage[]): string[] =>
    messages.map((message) => `${message.role}:${String(message.content)}`);

  test("between the step it arrived after and the step that answered it", () => {
    const responses = [say("assistant", "one"), say("assistant", "two"), say("assistant", "three")];
    expect(texts(withInjected(responses, [{ at: 2, message: say("user", "use bun") }]))).toEqual([
      "assistant:one",
      "assistant:two",
      "user:use bun",
      "assistant:three",
    ]);
  });

  test("two of them keep both their positions and their order", () => {
    const responses = [say("assistant", "one"), say("assistant", "two"), say("assistant", "three")];
    expect(
      texts(
        withInjected(responses, [
          { at: 1, message: say("user", "first") },
          { at: 3, message: say("user", "second") },
        ]),
      ),
    ).toEqual(["assistant:one", "user:first", "assistant:two", "assistant:three", "user:second"]);
  });

  // Cannot happen while step boundaries are what records the index — every
  // boundary has at least one response message behind it — but a stable sort
  // would otherwise reverse them, and that is a silent corruption.
  test("two at the same index stay in the order they arrived", () => {
    expect(
      texts(
        withInjected(
          [say("assistant", "one")],
          [
            { at: 1, message: say("user", "first") },
            { at: 1, message: say("user", "second") },
          ],
        ),
      ),
    ).toEqual(["assistant:one", "user:first", "user:second"]);
  });

  test("nothing injected leaves the responses exactly as they were", () => {
    const responses = [say("assistant", "one")];
    expect(withInjected(responses, [])).toEqual(responses);
    expect(withInjected(responses, [])).not.toBe(responses);
  });
});

// The session opens before a model is chosen, so the agent is built without one
// and every part of it works except the one that has to call a provider.
describe("an agent built before a model was chosen", () => {
  const bare = () =>
    createAgent({
      root: "/tmp",
      model: null,
      sessionId: "no-model",
      rules: "",
      cwd: "/tmp",
      os: "darwin",
      date: "2026-08-18",
      git: "",
      skills: "",
      skillTools: { catalog: "", commands: [], summaries: [], warnings: [], tool: undefined },
      extensionTools: () => ({}) as ToolSet,
    });

  test("it builds, and its tools and prompt are there", () => {
    const agent = bare();
    expect(agent.toolNames()).toEqual(expect.any(Array));
    expect(agent.prompt().length).toBeGreaterThan(0);
  });

  test("running a turn refuses rather than calling a provider", async () => {
    await expect(
      bare().run("hello", [], {
        signal: new AbortController().signal,
        onStep: () => {},
        onTool: () => {},
        onDelta: () => {},
        onReasoningEnd: () => {},
        onPhase: () => {},
      }),
    ).rejects.toThrow("No model is selected");
  });

  test("compacting refuses too, rather than summarising into nothing", async () => {
    await expect(bare().summarise([], "brief")).rejects.toThrow("No model is selected");
  });

  test("setting one makes it usable without rebuilding the agent", () => {
    const agent = bare();
    const model: ModelOption = { name: "test", provider: "azure", modelId: "test", env: [] };
    expect(() => agent.setModel(model)).not.toThrow();
  });
});

// The SDK logs these with `process.emitWarning`, which lands on the alternate
// screen at whatever cursor position is current and shreds the display.
describe("provider warnings", () => {
  const captured = (): { seen: string[]; emit: typeof globalThis.AI_SDK_LOG_WARNINGS } => {
    const seen: string[] = [];
    routeProviderWarnings((message) => seen.push(message));
    return { seen, emit: globalThis.AI_SDK_LOG_WARNINGS };
  };

  test("they are reported through the caller, not the terminal", () => {
    const { seen, emit } = captured();
    if (typeof emit !== "function") throw new Error("no logger installed");
    emit({
      warnings: [{ type: "unsupported", feature: "toolChoice" }],
      provider: "azure.responses",
      model: "gpt-5.6-luna",
    });
    expect(seen).toEqual(["azure.responses/gpt-5.6-luna: toolChoice is not supported"]);
  });

  // The one that buried the screen. It arrives once per model call and carries
  // the whole reasoning block in `message`, so a key made from the full string
  // is unique every time.
  test("the same warning about different content is said once", () => {
    const { seen, emit } = captured();
    if (typeof emit !== "function") throw new Error("no logger installed");
    const skipped = (text: string) => ({
      type: "other" as const,
      message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify({ type: "reasoning", text })}.`,
    });
    for (const text of ["thinking about one", "thinking about two", "thinking about three"])
      emit({ warnings: [skipped(text)], provider: "azure.responses", model: "gpt-5.6-luna" });
    expect(seen).toHaveLength(1);
  });

  test("a long one is clipped rather than pasted whole", () => {
    const { seen, emit } = captured();
    if (typeof emit !== "function") throw new Error("no logger installed");
    emit({ warnings: [{ type: "other", message: "x".repeat(5000) }], provider: "azure" });
    expect(seen[0].length).toBeLessThan(220);
  });

  test("two different warnings both get through", () => {
    const { seen, emit } = captured();
    if (typeof emit !== "function") throw new Error("no logger installed");
    emit({
      warnings: [
        { type: "unsupported", feature: "toolChoice" },
        { type: "compatibility", feature: "store", details: "replayed inline" },
      ],
      provider: "azure",
      model: "gpt-5.6-luna",
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("store is in compatibility mode. replayed inline");
  });
});
