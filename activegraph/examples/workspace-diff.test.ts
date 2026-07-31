import { describe, expect, test } from "bun:test";
import type { Workspace } from "./coding-agent";
import { describeChanges, undoHint, workspaceChanges } from "./workspace-diff";

const base: Workspace = {
  cwd: "/repo",
  gitRoot: "/repo",
  branch: "main",
  dirty: [" M README.md"],
  entries: ["README.md", "src/"],
};

describe("workspace changes", () => {
  test("an untouched tree reports nothing", () => {
    expect(describeChanges(base, base)).toBeNull();
    expect(workspaceChanges(base, base)).toEqual({
      createdEntries: [],
      removedEntries: [],
      newlyDirty: [],
    });
  });

  test("names what appeared, what went away, and what is newly uncommitted", () => {
    const after: Workspace = {
      ...base,
      entries: ["README.md", "notes.txt", "src/"],
      dirty: [" M README.md", "?? notes.txt", " M src/app.ts"],
    };

    expect(workspaceChanges(base, after)).toEqual({
      createdEntries: ["notes.txt"],
      removedEntries: [],
      newlyDirty: ["?? notes.txt", " M src/app.ts"],
    });
    const described = describeChanges(base, after);
    expect(described).toContain("created: notes.txt");
    expect(described).toContain("uncommitted: notes.txt, src/app.ts");
    // Already dirty before the run, so it is not news.
    expect(described).not.toContain("README.md");
  });

  test("a deletion is reported even though nothing new is dirty", () => {
    const after: Workspace = { ...base, entries: ["README.md"], dirty: [" M README.md"] };

    expect(describeChanges(base, after)).toBe("removed: src/");
  });

  test("works outside a repository, where nothing is ever dirty", () => {
    const outside: Workspace = { cwd: "/tmp/scratch", entries: ["a.txt"] };
    const after: Workspace = { ...outside, entries: ["a.txt", "b.txt"] };

    expect(describeChanges(outside, after)).toBe("created: b.txt");
  });
});

describe("undoHint", () => {
  const clean: Workspace = {
    cwd: "/repo",
    gitRoot: "/repo",
    branch: "main",
    dirty: [],
    entries: [],
  };

  test("names the files the run dirtied, and nothing else", () => {
    const after: Workspace = { ...clean, dirty: [" M src/text.ts", " M src/text.test.ts"] };

    expect(undoHint(clean, after)).toBe("git restore -- src/text.ts src/text.test.ts");
  });

  test("never offers to restore work the operator had already started", () => {
    // ` M notes.md` was dirty before the run: restoring it would destroy work
    // the agent never touched.
    const before: Workspace = { ...clean, dirty: [" M notes.md"] };
    const after: Workspace = { ...clean, dirty: [" M notes.md", " M src/text.ts"] };

    expect(undoHint(before, after)).toBe("git restore -- src/text.ts");
  });

  test("leaves untracked files alone, since undoing them means deleting them", () => {
    const after: Workspace = { ...clean, dirty: ["?? scratch.txt"] };

    expect(undoHint(clean, after)).toBeNull();
  });

  test("says nothing when there is no repository or nothing changed", () => {
    expect(undoHint(clean, clean)).toBeNull();
    expect(undoHint({ cwd: "/tmp/x", entries: [] }, { cwd: "/tmp/x", entries: [] })).toBeNull();
  });
});
