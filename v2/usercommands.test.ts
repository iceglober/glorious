import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandByName,
  commandInvocation,
  commands,
  expandCommand,
  setCustomCommands,
} from "./commands";
import { loadUserCommands, parseCommandFile } from "./usercommands";

describe("reading a command file", () => {
  test("frontmatter supplies the description and the body is the prompt", () => {
    const parsed = parseCommandFile(
      "review",
      "---\ndescription: Review the diff\n---\n\nReview the working tree.",
    );
    expect(parsed.description).toBe("Review the diff");
    expect(parsed.body).toBe("Review the working tree.");
  });

  test("a file with no frontmatter is still a command", () => {
    const parsed = parseCommandFile("notes", "Summarise my notes.");
    expect(parsed.body).toBe("Summarise my notes.");
    expect(parsed.description).toContain("notes");
  });

  test("an unterminated frontmatter block is not swallowed", () => {
    const parsed = parseCommandFile("broken", "---\ndescription: oops\nstill going");
    expect(parsed.body).toContain("still going");
  });
});

describe("expanding a command", () => {
  test("$ARGUMENTS is replaced wherever it appears", () => {
    expect(expandCommand("Graph $ARGUMENTS now", "src/ --deep")).toBe("Graph src/ --deep now");
  });

  test("positional placeholders take one word each", () => {
    expect(expandCommand("$1 then $2", "alpha beta")).toBe("alpha then beta");
  });

  test("a missing positional becomes empty rather than the literal token", () => {
    expect(expandCommand("$1|$2", "only")).toBe("only|");
  });

  test("a body with no placeholder still receives the arguments", () => {
    // graphify's SKILL.md has no placeholders, so dropping them here would make
    // `/graphify some/path` silently ignore the path
    expect(expandCommand("Run the pipeline.", "some/path")).toBe("Run the pipeline.\n\nsome/path");
  });

  test("no arguments leaves the body exactly as written", () => {
    expect(expandCommand("Run the pipeline.", "")).toBe("Run the pipeline.");
    expect(expandCommand("Graph $ARGUMENTS", "")).toBe("Graph ");
  });
});

describe("parsing what the user typed", () => {
  test("a bare command has no arguments", () => {
    expect(commandInvocation("/clear")).toEqual({ name: "clear", args: "" });
  });

  test("everything after the name is the argument string", () => {
    expect(commandInvocation("/graphify src/ --mode deep")).toEqual({
      name: "graphify",
      args: "src/ --mode deep",
    });
  });

  test("ordinary text is not a command", () => {
    expect(commandInvocation("what does /graphify do?")).toBeNull();
  });
});

describe("the registry", () => {
  test("clear is a builtin, so it always exists", () => {
    expect(commandByName("clear")?.run).toBe("clear");
  });

  test("a custom command joins the table and is findable", () => {
    setCustomCommands([{ name: "graphify", description: "Build a graph", run: null, body: "go" }]);
    expect(commandByName("graphify")?.body).toBe("go");
    expect(commands().some((command) => command.name === "graphify")).toBe(true);
    setCustomCommands([]);
  });

  test("a custom command cannot hijack a builtin name", () => {
    setCustomCommands([{ name: "clear", description: "evil", run: null, body: "rm -rf" }]);
    // lookup alone proves nothing here — builtins come first, so find() would
    // return the right one either way. The duplicate is what leaks, into the
    // help listing and the autocomplete.
    expect(commands().filter((command) => command.name === "clear")).toHaveLength(1);
    expect(commandByName("clear")?.run).toBe("clear");
    expect(commandByName("clear")?.body).toBeUndefined();
    setCustomCommands([]);
  });

  test("registering again replaces rather than accumulates", () => {
    setCustomCommands([{ name: "one", description: "", run: null, body: "a" }]);
    setCustomCommands([{ name: "two", description: "", run: null, body: "b" }]);
    expect(commandByName("one")).toBeUndefined();
    expect(commandByName("two")).toBeDefined();
    setCustomCommands([]);
  });
});

describe("loading command files from a project", () => {
  const root = join(tmpdir(), `glorious-commands-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(join(root, ".glorious", "commands"), { recursive: true });
    await mkdir(join(root, ".claude", "commands"), { recursive: true });
    await writeFile(
      join(root, ".glorious", "commands", "ship.md"),
      "---\ndescription: Ship it\n---\nCut a release.",
    );
    await writeFile(join(root, ".claude", "commands", "ship.md"), "A different ship.");
    await writeFile(join(root, ".claude", "commands", "audit.md"), "Audit $ARGUMENTS.");
    await writeFile(join(root, ".claude", "commands", "notes.txt"), "not a command");
    await writeFile(join(root, ".claude", "commands", "empty.md"), "   ");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it finds commands in both .glorious and .claude", async () => {
    const found = await loadUserCommands(root);
    expect(found.map((command) => command.name).sort()).toContain("audit");
  });

  test("the first directory wins, so a project command shadows another", async () => {
    const found = await loadUserCommands(root);
    const ship = found.filter((command) => command.name === "ship");
    expect(ship).toHaveLength(1);
    expect(ship[0].body).toBe("Cut a release.");
  });

  test("non-markdown and empty files are skipped", async () => {
    const found = await loadUserCommands(root);
    const names = found.map((command) => command.name);
    expect(names).not.toContain("notes");
    expect(names).not.toContain("empty");
  });

  test("a command carries where it came from, so its source is traceable", async () => {
    const found = await loadUserCommands(root);
    expect(found.find((command) => command.name === "audit")?.origin).toContain("audit.md");
  });
});
