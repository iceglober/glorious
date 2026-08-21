import { afterEach, describe, expect, test } from "bun:test";
import type {
  Capture,
  EventName,
  EventPayload,
  Glrs,
  Handler,
  Key,
  ModelInfo,
  Tone,
  WriteOutcome,
} from "../../../glrs-core/src";
import modelPicker, { patchReasoningBody } from "./index";

type Command = { run: (args: string) => void | Promise<void> };
type Hook = (payload: EventPayload["before_provider_request"]) => unknown;

const model = (
  label: string,
  variants?: readonly string[],
  missing: readonly string[] = [],
): ModelInfo => {
  const slash = label.indexOf("/");
  return {
    label,
    provider: label.slice(0, slash),
    modelId: label.slice(slash + 1),
    variants,
    missing,
  };
};

const harness = (
  options: {
    current?: ModelInfo | null;
    models?: readonly ModelInfo[];
    hasUI?: boolean;
    remember?: WriteOutcome;
  } = {},
) => {
  const commands = new Map<string, Command>();
  const hooks = new Map<EventName, Handler<EventName>>();
  const selected: Array<{ label: string; variant?: string }> = [];
  const printed: Array<{ text: string; tone?: Tone }> = [];
  let capture: Capture | null = null;
  let closed = false;
  let current: ModelInfo | null =
    options.current === undefined
      ? model("anthropic/claude-opus-5", ["low", "high"])
      : options.current;
  const remembered: WriteOutcome[] = [];
  const catalogue = options.models ?? [
    current ?? model("anthropic/claude-opus-5", ["low", "high"]),
    model("openai/gpt-5.2", ["minimal", "low", "medium", "high", "xhigh"]),
    model("ollama/qwen3"),
  ];
  const g = {
    hasUI: options.hasUI ?? true,
    command: (name: string, spec: Command) => commands.set(name, spec),
    on: (name: EventName, handler: Handler<EventName>) => hooks.set(name, handler),
    model: () => current,
    models: async () => catalogue,
    setModel: async (label: string, variant?: string) => {
      selected.push({ label, variant });
      current = { ...model(label), variant };
    },
    rememberModel: async () => {
      const outcome = options.remember ?? "written";
      remembered.push(outcome);
      return outcome;
    },
    print: (text: string, tone?: Tone) => printed.push({ text, tone }),
    clip: (text: string, limit: number) =>
      text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`,
    ui: {
      capture: (spec: Capture) => {
        capture = spec;
        return {
          close: () => {
            closed = true;
          },
          repaint: () => {},
        };
      },
    },
  } as unknown as Glrs;
  modelPicker(g);
  const press = (key: string, text = ""): void =>
    capture?.onKey({ key, text, ctrl: false, shift: false } as Key);
  const screen = (): string =>
    (capture?.render(100) ?? []).map((line) => line.map((span) => span.text).join("")).join("\n");
  return {
    command: commands.get("model") as Command,
    beforeRequest: hooks.get("before_provider_request") as Hook,
    sessionStart: hooks.get("session_start") as () => Promise<unknown>,
    press,
    printed,
    remembered,
    screen,
    selected,
    wasClosed: () => closed,
  };
};

afterEach(() => {
  delete process.env.AZURE_FOUNDRY_API_KEY;
});

describe("the model picker", () => {
  test("shows catalogue models and the two Azure DeepSeek additions", async () => {
    const picker = harness();
    await picker.command.run("");
    expect(picker.screen()).toContain("anthropic/claude-opus-5");
    expect(picker.screen()).toContain("azure-deepseek/DeepSeek-V4-Flash");
  });

  test("filters from command arguments and selects a model with no variants", async () => {
    const picker = harness();
    await picker.command.run("ollama qwen");
    expect(picker.screen()).toContain("ollama/qwen3");
    expect(picker.screen()).not.toContain("openai/gpt-5.2");
    picker.press("return");
    await Bun.sleep(0);
    expect(picker.selected).toEqual([{ label: "ollama/qwen3", variant: undefined }]);
    expect(picker.wasClosed()).toBe(true);
  });

  test("asks for Azure DeepSeek effort and switches with the chosen value", async () => {
    const picker = harness();
    await picker.command.run("deepseek-v4-pro");
    picker.press("return");
    expect(picker.screen()).toContain("Reasoning for azure-deepseek/deepseek-v4-pro");
    picker.press("down");
    picker.press("down");
    picker.press("return");
    await Bun.sleep(0);
    expect(picker.selected).toEqual([
      { label: "azure-deepseek/deepseek-v4-pro", variant: "medium" },
    ]);
  });

  test("requires the TUI instead of trying to capture in print mode", async () => {
    const picker = harness({ hasUI: false });
    await picker.command.run("");
    expect(picker.printed).toEqual([
      { text: "The model picker requires the TUI.", tone: "warning" },
    ]);
  });
});

// A session opens without a model now, so the picker is the thing that fills
// the hole rather than something you have to know to type.
describe("a session that opened with no model", () => {
  test("session_start opens the picker when nothing is chosen", async () => {
    const picker = harness({ current: null });
    await picker.sessionStart();
    expect(picker.screen()).toContain("Choose model");
  });

  test("session_start leaves an already chosen model alone", async () => {
    const picker = harness();
    await picker.sessionStart();
    expect(picker.screen()).toBe("");
  });

  test("nothing is marked current when nothing is", async () => {
    const picker = harness({ current: null });
    await picker.sessionStart();
    expect(picker.screen()).not.toContain("current");
  });
});

describe("a provider with no credential glrs can see", () => {
  const unreachable = [
    model("anthropic/claude-opus-5"),
    model("openai/gpt-5.2", [], ["OPENAI_API_KEY"]),
  ];

  test("models glrs has credentials for are listed first", async () => {
    const picker = harness({ models: [...unreachable].reverse() });
    await picker.command.run("");
    const rows = picker.screen().split("\n");
    expect(rows.findIndex((row) => row.includes("anthropic/claude-opus-5"))).toBeLessThan(
      rows.findIndex((row) => row.includes("openai/gpt-5.2")),
    );
  });

  test("the row says what is missing", async () => {
    const picker = harness({ models: unreachable });
    await picker.command.run("gpt");
    expect(picker.screen()).toContain("needs OPENAI_API_KEY");
  });

  // Chosen, not refused: glrs reads the environment and config only, so an AWS
  // profile on disk or a provider another extension registers looks exactly
  // like this and works.
  test("choosing it still switches, and says what to set", async () => {
    const picker = harness({ models: unreachable });
    await picker.command.run("gpt");
    picker.press("return");
    await Bun.sleep(0);
    expect(picker.selected).toEqual([{ label: "openai/gpt-5.2", variant: undefined }]);
    expect(picker.printed.map((one) => one.text).join("\n")).toContain(
      "openai: glrs cannot see OPENAI_API_KEY",
    );
  });
});

describe("keeping the choice", () => {
  test("the choice is recorded once the switch lands", async () => {
    const picker = harness();
    await picker.command.run("ollama qwen");
    picker.press("return");
    await Bun.sleep(0);
    expect(picker.remembered).toEqual(["written"]);
  });

  test("config glrs may not write prints the line to paste instead", async () => {
    const picker = harness({ remember: "not-allowed" });
    await picker.command.run("ollama qwen");
    picker.press("return");
    await Bun.sleep(0);
    expect(picker.printed.map((one) => one.text).join("\n")).toContain('"model": "ollama/qwen3"');
  });

  test("a switch that failed records nothing", async () => {
    const picker = harness({ models: [model("ollama/qwen3")] });
    await picker.command.run("nothing matches this");
    picker.press("return");
    await Bun.sleep(0);
    expect(picker.remembered).toEqual([]);
  });
});

describe("Azure DeepSeek request compatibility", () => {
  test("patches object, JSON string, and byte request bodies", () => {
    expect(patchReasoningBody({ messages: [] }, "high")).toEqual({
      messages: [],
      reasoning_effort: "high",
    });
    expect(JSON.parse(patchReasoningBody('{"messages":[]}', "max") as string)).toMatchObject({
      reasoning_effort: "max",
    });
    const bytes = patchReasoningBody(new TextEncoder().encode("{}"), "low") as Uint8Array;
    expect(new TextDecoder().decode(bytes)).toContain('"reasoning_effort":"low"');
  });

  test("adds the Foundry key and selected effort only for azure-deepseek", () => {
    process.env.AZURE_FOUNDRY_API_KEY = "secret";
    const picker = harness({
      current: {
        ...model("azure-deepseek/deepseek-v4-pro"),
        variant: "xhigh",
      },
    });
    expect(picker.beforeRequest({ url: "https://example.test", headers: {}, body: {} })).toEqual({
      headers: { "api-key": "secret" },
      body: { reasoning_effort: "xhigh" },
    });

    const ordinary = harness();
    expect(
      ordinary.beforeRequest({ url: "https://example.test", headers: {}, body: {} }),
    ).toBeUndefined();
  });
});
