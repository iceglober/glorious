import { describe, expect, test } from "bun:test";
import { activeSlash, commandName, matchingCommands } from "./commands";

describe("slash commands", () => {
  test("activates after whitespace but not inside a word", () => {
    expect(activeSlash("show /he", 8)).toEqual({ start: 5, query: "he" });
    expect(activeSlash("https://", 8)).toBeNull();
  });

  test("fuzzy matches command names", () => {
    expect(matchingCommands("hp").map((command) => command.name)).toEqual(["help"]);
  });

  test("parses a command submission", () => {
    expect(commandName(" /help ")).toBe("help");
    expect(commandName("help")).toBeNull();
  });
});
