import { describe, expect, test } from "bun:test";
import {
  activeSigil,
  commandName,
  commands,
  matchingCommands,
  shortcutInvocation,
} from "./commands";

const slashes = ["/"] as const;
const both = ["/", "$"] as const;

describe("slash commands", () => {
  test("activates after whitespace but not inside a word", () => {
    expect(activeSigil("show /he", 8, slashes)).toEqual({ sigil: "/", start: 5, query: "he" });
    expect(activeSigil("https://", 8, slashes)).toBeNull();
  });

  test("fuzzy matches command names", () => {
    expect(matchingCommands("hp").map((command) => command.name)).toEqual(["help"]);
  });

  test("includes the mcp command", () => {
    expect(matchingCommands("mcp").map((command) => command.name)).toEqual(["mcp"]);
  });

  test("parses a command submission", () => {
    expect(commandName(" /help ")).toBe("help");
    expect(commandName("help")).toBeNull();
  });

  // One mode, so there is nothing to cycle. A command file is free to claim the
  // name now, which the builtin table would previously have refused.
  test("offers no mode command", () => {
    expect(commands().find((command) => command.name === "mode")).toBeUndefined();
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
