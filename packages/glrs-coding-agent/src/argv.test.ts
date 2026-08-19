import { describe, expect, test } from "bun:test";
import { ArgvError, helpText, route, subcommandOf } from "./argv";

// Every case here was a real defect in the index-arithmetic parser this
// replaced. They are written as the wrong answer it used to give, so a
// regression reads as the old bug coming back.

const kindOf = async (args: string[]): Promise<string> => (await route(args)).kind;

describe("a flag's value is not merely the next token", () => {
  test("the next flag is refused rather than taken as the model", async () => {
    // Used to set the model to "-p" and then run headless anyway.
    await expect(route(["--model", "-p", "hi"])).rejects.toThrow("another flag");
  });

  test("a trailing --model is an error, not silence", async () => {
    // Used to be dropped with no notice, starting an ordinary session.
    await expect(route(["--model"])).rejects.toThrow("--model needs a value");
  });

  test("a model id without a provider is refused, since there is no default", async () => {
    await expect(route(["--model", "gpt-5"])).rejects.toThrow("names no provider");
  });

  test("a real model id is taken", async () => {
    expect(await route(["--model", "azure/gpt-5"])).toMatchObject({ model: "azure/gpt-5" });
  });

  test("--resume does not eat the flag after it", async () => {
    // Used to look for a session called "--model".
    expect(await route(["--resume", "--model", "a/b"])).toMatchObject({
      picker: true,
      resume: undefined,
      model: "a/b",
    });
  });
});

describe("-p and a subcommand no longer fight over argv", () => {
  test("a subcommand before -p keeps its own arguments", async () => {
    // `glrs wt -p hi` used to run a headless turn and discard `wt`.
    expect(await route(["wt", "-p", "hi"])).toEqual({
      kind: "subcommand",
      name: "wt",
      rest: ["-p", "hi"],
    });
  });

  test("a bare word inside a prompt is not a subcommand", async () => {
    expect(await route(["-p", "what", "failed"])).toMatchObject({ prompt: "what failed" });
  });

  test("the prompt is verbatim, so it may contain what looks like a flag", async () => {
    expect(await route(["-p", "use --model wisely"])).toMatchObject({
      prompt: "use --model wisely",
    });
  });

  test("bare -p is a run waiting on piped input, not a session", async () => {
    expect(await route(["-p"])).toEqual({ kind: "print", prompt: "", model: undefined });
  });

  test("a subcommand's own argument is not read as glrs's", async () => {
    expect(await route(["wt", "doctor"])).toMatchObject({ name: "wt", rest: ["doctor"] });
  });
});

describe("flags glrs does not know are carried, not dropped", () => {
  test("an unknown flag reaches the extensions that may claim it", async () => {
    const outcome = await route(["--custom", "value"]);
    expect(outcome.kind === "chat" && outcome.flags.get("custom")).toBe("value");
  });

  test("capitals are carried too", async () => {
    // The old scan was /^--([a-z][a-z0-9-]*)$/u, so --Foo matched nothing and
    // vanished without even the "(unknown flag:)" line.
    const outcome = await route(["--Foo", "bar"]);
    expect(outcome.kind === "chat" && outcome.flags.get("foo")).toBe("bar");
  });

  test("one given no value is carried as empty rather than swallowing a flag", async () => {
    const outcome = await route(["--custom", "--resume"]);
    expect(outcome.kind === "chat" && outcome.flags.get("custom")).toBe("");
    expect(outcome).toMatchObject({ picker: true });
  });
});

describe("glrs's own words", () => {
  test("version, help, doctor and update route without a session", async () => {
    expect(await kindOf(["--version"])).toBe("version");
    expect(await kindOf(["--help"])).toBe("help");
    expect(await kindOf(["update"])).toBe("update");
    expect(await route(["doctor", "--json"])).toEqual({ kind: "doctor", json: true });
  });

  test("--version and --help win wherever they sit", async () => {
    // Both used to require being the only argument.
    expect(await kindOf(["--model", "azure/x", "--version"])).toBe("version");
    expect(await kindOf(["doctor", "--help"])).toBe("help");
  });

  test("nothing at all is a session", async () => {
    expect(await route([])).toMatchObject({ kind: "chat", picker: false });
  });
});

describe("picking the subcommand out of argv", () => {
  test("the first bare word wins and keeps its arguments", () => {
    expect(subcommandOf(["wt", "new", "fix the thing"])).toEqual({
      name: "wt",
      rest: ["new", "fix the thing"],
    });
  });

  test("a flag's value is not mistaken for it", () => {
    expect(subcommandOf(["--model", "azure/x", "doctor"])?.name).toBe("doctor");
    expect(subcommandOf(["--model", "azure/x"])).toBeNull();
  });
});

describe("help", () => {
  test("it names glrs's own commands and options", () => {
    const said = helpText();
    expect(said).toContain("doctor [--json]");
    expect(said).toContain("--resume [session-id]");
    expect(said).toContain("-p, --print <prompt>");
  });

  test("an extension's subcommand is read from what it registered, not hardcoded", () => {
    const said = helpText([["wt", { description: "manage git worktrees" }]]);
    expect(said).toContain("Added by extensions:");
    expect(said).toContain("manage git worktrees");
  });

  test("with no extensions the block is absent rather than empty", () => {
    expect(helpText()).not.toContain("Added by extensions");
  });
});

describe("errors are one sentence, not a coloured block", () => {
  test("cmd-ts's terminal formatting does not reach the message", async () => {
    const thrown = await route(["--model", "gpt-5"]).catch((error: Error) => error);
    expect(thrown).toBeInstanceOf(ArgvError);
    const said = (thrown as Error).message;
    expect(said).not.toContain(String.fromCharCode(27));
    expect(said.split("\n")).toHaveLength(1);
  });
});
