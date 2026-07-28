import { describe, expect, test } from "bun:test";

import {
  DEFAULT_COMMAND_NAME,
  describeCli,
  EXIT_ABORTED,
  EXIT_SUCCESS,
  type GloriousCommandDependencies,
  runGloriousCli,
} from "./index";

function createMemoryWriter(): { write: (text: string) => true; text: () => string } {
  const chunks: string[] = [];

  return {
    write(text) {
      chunks.push(text);
      return true;
    },
    text() {
      return chunks.join("");
    },
  };
}

function makeDeps(over: Partial<GloriousCommandDependencies> = {}) {
  const chatCalls: number[] = [];
  const deps: GloriousCommandDependencies = {
    version: "1.2.3",
    async runChat() {
      chatCalls.push(1);
      return EXIT_SUCCESS;
    },
    ...over,
  };
  return { deps, chatCalls };
}

describe("runGloriousCli", () => {
  test("bare invocation opens the chat session", async () => {
    const { deps, chatCalls } = makeDeps();
    await expect(runGloriousCli([], deps)).resolves.toBe(EXIT_SUCCESS);
    expect(chatCalls).toHaveLength(1);
  });

  test("the chat session's exit code is the process exit code", async () => {
    const { deps } = makeDeps({ runChat: async () => EXIT_ABORTED });
    await expect(runGloriousCli([], deps)).resolves.toBe(EXIT_ABORTED);
  });

  test("--version prints the version to stdout with a trailing newline", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();
    const { deps, chatCalls } = makeDeps();
    await expect(runGloriousCli(["--version"], deps, { stdout, stderr })).resolves.toBe(
      EXIT_SUCCESS,
    );
    expect(stdout.text()).toBe("1.2.3\n");
    expect(stderr.text()).toBe("");
    expect(chatCalls).toHaveLength(0);
  });

  test("--help renders usage on stdout without opening a session", async () => {
    const stdout = createMemoryWriter();
    const { deps, chatCalls } = makeDeps();
    await expect(runGloriousCli(["--help"], deps, { stdout })).resolves.toBe(EXIT_SUCCESS);
    expect(stdout.text()).toContain("chat session");
    expect(stdout.text()).toEndWith("\n");
    expect(chatCalls).toHaveLength(0);
  });

  test("an unknown flag is a usage error on stderr, not a chat session", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();
    const { deps, chatCalls } = makeDeps();
    const code = await runGloriousCli(["--resume", "abc123"], deps, { stdout, stderr });
    expect(code).not.toBe(EXIT_SUCCESS);
    expect(stderr.text()).toContain("--resume");
    expect(stdout.text()).toBe("");
    expect(chatCalls).toHaveLength(0);
  });

  test("a stray positional is rejected — there are no subcommands", async () => {
    const stderr = createMemoryWriter();
    const { deps, chatCalls } = makeDeps();
    const code = await runGloriousCli(["run", "fix the flaky test"], deps, { stderr });
    expect(code).not.toBe(EXIT_SUCCESS);
    expect(chatCalls).toHaveLength(0);
  });

  test("describeCli describes the single chat command without running its handler", () => {
    const cli = describeCli();
    expect(cli).toHaveLength(1);
    const [chat] = cli;
    expect(chat?.name).toBe(DEFAULT_COMMAND_NAME);
    expect(chat?.description).toContain("chat session");
    // Bare invocation: no positionals, and nothing to document but --help/--version,
    // which the reference drops (docs deps carry no version, so no version row).
    expect(chat?.args).toEqual([]);
    expect(chat?.flags).toEqual([]);
    expect(cli.every((c) => c.flags.every((f) => !f.usage.startsWith("--help")))).toBe(true);
  });
});
