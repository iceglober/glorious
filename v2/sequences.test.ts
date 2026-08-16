import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shortcutPrompt } from "./prompt";
import { loadSequences, parseSequence } from "./sequences";

describe("reading a sequence file", () => {
  test("an inline run is the whole command", () => {
    const parsed = parseSequence(
      "status",
      "---\ndescription: Show status\nrun: git status -sb\n---",
    );
    expect(parsed?.run).toBe("git status -sb");
    expect(parsed?.description).toBe("Show status");
  });

  test("a block run keeps its lines and loses its indent", () => {
    const parsed = parseSequence(
      "fresh",
      ["---", "run: |", "  git checkout main", "  git pull --ff-only", "---", "", "Reset."].join(
        "\n",
      ),
    );
    expect(parsed?.run).toBe("git checkout main\ngit pull --ff-only");
  });

  test("a bare run: takes the block beneath it too", () => {
    const parsed = parseSequence("fresh", ["---", "run:", "  git status", "---"].join("\n"));
    expect(parsed?.run).toBe("git status");
  });

  test("the block stops at the next frontmatter key", () => {
    const parsed = parseSequence(
      "fresh",
      ["---", "run: |", "  git status", "clear: true", "---"].join("\n"),
    );
    expect(parsed?.run).toBe("git status");
    expect(parsed?.clear).toBe(true);
  });

  test("the body is the prompt, and empty when there is none", () => {
    const withBody = parseSequence("review", "---\nrun: git diff\n---\n\nReview this.");
    expect(withBody?.body).toBe("Review this.");
    // The absent body is the whole point: this is the sequence that produces
    // no turn at all.
    expect(parseSequence("fresh", "---\nrun: git status\n---\n")?.body).toBe("");
  });

  test("clear defaults to false", () => {
    expect(parseSequence("fresh", "---\nrun: git status\n---")?.clear).toBe(false);
  });

  test("a file with no run is not a sequence", () => {
    // Prose with no command is a slash command; routing it through `$` would
    // give it a sigil that promises something deterministic.
    expect(parseSequence("notes", "---\ndescription: Just prose\n---\n\nSummarise.")).toBeNull();
    expect(parseSequence("notes", "Summarise my notes.")).toBeNull();
  });

  test("an unterminated frontmatter block is not swallowed", () => {
    expect(parseSequence("broken", "---\nrun: git status\nstill going")).toBeNull();
  });

  test("a missing description falls back to the name", () => {
    expect(parseSequence("fresh", "---\nrun: git status\n---")?.description).toContain("fresh");
  });
});

describe("building the turn a sequence sends", () => {
  test("stdout rides along as evidence, fenced away from the request", () => {
    expect(shortcutPrompt("Review this.", "diff --git a/x b/x")).toBe(
      "Review this.\n\n<output>\ndiff --git a/x b/x\n</output>",
    );
  });

  test("a silent run sends the prose alone", () => {
    expect(shortcutPrompt("Review this.", "   ")).toBe("Review this.");
  });
});

describe("loading sequence files from a project", () => {
  const root = join(tmpdir(), `glorious-sequences-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(join(root, ".glorious", "sequences"), { recursive: true });
    await mkdir(join(root, ".agents", "sequences"), { recursive: true });
    await writeFile(
      join(root, ".glorious", "sequences", "fresh.md"),
      "---\ndescription: Reset to a clean main\nrun: git checkout main\nclear: true\n---",
    );
    await writeFile(
      join(root, ".agents", "sequences", "fresh.md"),
      "---\ndescription: The personal one\nrun: echo shadowed\n---",
    );
    await writeFile(
      join(root, ".agents", "sequences", "seed.md"),
      "---\ndescription: Seed the database\nrun: ./seed.sh\n---",
    );
    await writeFile(join(root, ".glorious", "sequences", "notes.txt"), "not markdown");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("both directories are searched", async () => {
    const { sequences: found } = await loadSequences(root);
    expect(found.map((sequence) => sequence.name).sort()).toEqual(["fresh", "seed"]);
  });

  test("the project definition shadows the personal one", async () => {
    const { sequences: found } = await loadSequences(root);
    expect(found.find((sequence) => sequence.name === "fresh")?.run).toBe("git checkout main");
  });

  test("non-markdown files are ignored", async () => {
    const { sequences: found } = await loadSequences(root);
    expect(found.some((sequence) => sequence.name === "notes")).toBe(false);
  });
});
