import { describe, expect, test } from "bun:test";
import {
  activeSigil,
  commandInvocation,
  commandName,
  commands,
  matchingCommands,
  matchNames,
  setCustomCommands,
} from "./commands";

const slashes = ["/"] as const;

// The table is empty until something registers into it — the core ships no
// commands of its own — so these seed what they are matching against rather
// than leaning on a builtin list that no longer exists.
const seed = (...names: string[]): void =>
  setCustomCommands(names.map((name) => ({ name, description: name, run: null, body: name })));

describe("slash commands", () => {
  test("activates after whitespace but not inside a word", () => {
    expect(activeSigil("show /he", 8, slashes)).toEqual({ sigil: "/", start: 5, query: "he" });
    expect(activeSigil("https://", 8, slashes)).toBeNull();
  });

  test("fuzzy matches command names", () => {
    seed("help", "clear", "extensions");
    expect(matchingCommands("hp").map((command) => command.name)).toEqual(["help"]);
    expect(matchingCommands("ext").map((command) => command.name)).toEqual(["extensions"]);
    setCustomCommands([]);
  });

  test("parses a command submission", () => {
    expect(commandName(" /help ")).toBe("help");
    expect(commandName("help")).toBeNull();
  });

  // Nothing is reserved, because nothing is built in: an extension or a command
  // file may register any name, /clear included.
  test("no name is reserved by the core", () => {
    setCustomCommands([]);
    expect(commands()).toEqual([]);
    seed("clear");
    expect(commands().map((command) => command.name)).toEqual(["clear"]);
    setCustomCommands([]);
  });
});

// Skills live under a `skill:` prefix, so a colon has to survive the parse. It
// did not: `/skill:graphify` matched nothing and fell through to "unknown
// command", which would have made every skill uninvokable.
describe("a namespaced command", () => {
  test("the name keeps its colon", () => {
    expect(commandInvocation("/skill:graphify")).toEqual({ name: "skill:graphify", args: "" });
  });

  test("arguments still travel with it", () => {
    expect(commandInvocation("/skill:graphify src/ --deep")).toEqual({
      name: "skill:graphify",
      args: "src/ --deep",
    });
  });

  test("an ordinary command is unaffected", () => {
    expect(commandInvocation("/help")).toEqual({ name: "help", args: "" });
  });

  // The scorer is a fuzzy match, so the prefix does not have to be typed.
  test("typing the bare skill name still finds it", () => {
    const found = matchNames([{ name: "skill:graphify" }, { name: "help" }], "graphify");
    expect(found[0]?.name).toBe("skill:graphify");
  });
});

// Reported from a live session: the completion list would not scroll past what
// was on screen. It was not the scrolling — the list was cut to six before the
// composer's window ever saw it, so there was nothing further to scroll to and
// the "n more" line had nothing to count.
describe("how many matches the composer is given", () => {
  const many = Array.from({ length: 37 }, (_, at) => ({ name: `command-${at}` }));

  test("every match is returned, not the first six", () => {
    expect(matchNames(many, "command").length).toBe(37);
  });

  test("an empty query still offers everything", () => {
    expect(matchNames(many, "").length).toBe(37);
  });

  // Same score, so the shorter name wins: fewer characters between what you
  // typed and what you meant.
  test("ranking still puts the best first", () => {
    const found = matchNames([{ name: "dependencies" }, { name: "deploy" }], "dep");
    expect(found[0].name).toBe("deploy");
    expect(found).toHaveLength(2);
  });

  test("something that matches nothing returns nothing", () => {
    expect(matchNames(many, "zzzz")).toEqual([]);
  });
});
