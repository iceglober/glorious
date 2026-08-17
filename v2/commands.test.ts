import { describe, expect, test } from "bun:test";
import {
  activeSigil,
  commandName,
  commands,
  matchingCommands,
  setCustomCommands,
  shortcutInvocation,
} from "./commands";

const slashes = ["/"] as const;
const both = ["/", "$"] as const;

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

describe("sequence shortcuts", () => {
  test("each sigil completes only its own namespace", () => {
    expect(activeSigil("$fr", 3, both)).toEqual({ sigil: "$", start: 0, query: "fr" });
    expect(activeSigil("/he", 3, both)).toEqual({ sigil: "/", start: 0, query: "he" });
  });

  test("the sigil being typed wins when both are present", () => {
    expect(activeSigil("/help then $fr", 14, both)).toEqual({
      sigil: "$",
      start: 11,
      query: "fr",
    });
  });

  test("a sigil mid-word is prose, not a shortcut", () => {
    expect(activeSigil("costs US$5", 10, both)).toBeNull();
    expect(activeSigil("PATH=$HOME", 10, both)).toBeNull();
  });

  test("parses a shortcut submission with its arguments", () => {
    expect(shortcutInvocation("$fresh")).toEqual({ name: "fresh", args: "" });
    expect(shortcutInvocation(" $fresh main ")).toEqual({ name: "fresh", args: "main" });
    expect(shortcutInvocation("fresh")).toBeNull();
    expect(shortcutInvocation("/fresh")).toBeNull();
  });
});
