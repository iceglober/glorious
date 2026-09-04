import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "../../../glrs-core/src/shell";
import {
  audit,
  autoName,
  create,
  defaultBranch,
  list,
  mainRepo,
  remove,
  runNewHook,
  slug,
  worktreesRoot,
} from "./worktree";

// Real git repositories in a temp directory. Every one of these is a claim about
// what git does, so faking it would only test the fake.

const scratch: string[] = [];

// A repo with a bare "origin" beside it, so `fetch origin main` is real.
const repository = async (): Promise<{ repo: string; home: string }> => {
  const home = await mkdtemp(join(tmpdir(), "glrs-wt-"));
  scratch.push(home);
  const origin = join(home, "origin.git");
  const repo = join(home, "repo");
  await runShell(home, `git init --bare --initial-branch=main ${JSON.stringify(origin)} --quiet`);
  await runShell(home, `git clone --quiet ${JSON.stringify(origin)} ${JSON.stringify(repo)}`);
  await runShell(repo, "git config user.email a@b.c && git config user.name Test");
  await writeFile(join(repo, "README.md"), "hello\n");
  await runShell(repo, "git add -A && git commit -q -m first && git push -q -u origin main");
  return { repo, home };
};

// A repo whose origin exists but has nothing in it: cloned before anyone pushed,
// or pointed at a repository being kept empty on purpose. `main` is local only.
const unpushed = async (): Promise<{ repo: string; home: string }> => {
  const home = await mkdtemp(join(tmpdir(), "glrs-wt-"));
  scratch.push(home);
  const origin = join(home, "origin.git");
  const repo = join(home, "repo");
  await runShell(home, `git init --bare --initial-branch=main ${JSON.stringify(origin)} --quiet`);
  await runShell(home, `git clone --quiet ${JSON.stringify(origin)} ${JSON.stringify(repo)}`);
  await runShell(repo, "git config user.email a@b.c && git config user.name Test");
  await writeFile(join(repo, "README.md"), "hello\n");
  await runShell(repo, "git add -A && git commit -q -m first");
  return { repo, home };
};

afterAll(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

describe("turning a description into a name", () => {
  test("a sentence becomes a branch you would have typed", () => {
    expect(slug("Fix the login redirect")).toBe("fix-the-login-redirect");
  });

  test("punctuation and runs of separators collapse", () => {
    expect(slug("fix:  the  login/redirect!!")).toBe("fix-the-login-redirect");
  });

  test("it never starts or ends with a dash", () => {
    expect(slug("  --leading and trailing--  ")).toBe("leading-and-trailing");
    expect(slug("a".repeat(60))).toHaveLength(50);
  });

  test("something with nothing usable in it comes back empty, so the caller auto-names", () => {
    expect(slug("!!!")).toBe("");
  });

  test("an auto name is sortable and unique enough", () => {
    const at = new Date(2026, 7, 19, 9, 30, 0);
    expect(autoName(at, "abc")).toBe("wt-260819-093000-abc");
    // Local time, matching the layout that already exists on disk.
    expect(autoName(at, "a")).toBe("wt-260819-093000-a00");
  });
});

describe("finding the repository", () => {
  test("from the checkout itself", async () => {
    const { repo } = await repository();
    expect(await mainRepo(repo)).toBe(await realpath(repo));
  });

  // The interesting one: --show-toplevel would answer with the worktree.
  test("from inside one of its worktrees", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "from inside", home });
    expect(await mainRepo(made.path)).toBe(await realpath(repo));
  });

  test("the default branch comes from the remote", async () => {
    const { repo } = await repository();
    expect(await defaultBranch(repo)).toBe("main");
  });

  test("the worktree root honours the environment override", () => {
    expect(worktreesRoot("myrepo", "/home/me")).toBe("/home/me/.glrs/worktrees/myrepo");
  });
});

describe("creating one", () => {
  test("the description becomes the branch and the directory alike", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "Fix the login redirect", home });
    expect(made.branch).toBe("fix-the-login-redirect");
    expect(made.path).toBe(join(home, ".glrs", "worktrees", "repo", "fix-the-login-redirect"));
    expect(await Bun.file(join(made.path, "README.md")).text()).toBe("hello\n");
  });

  test("with no description it auto-names", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { home });
    expect(made.branch).toMatch(/^wt-\d{6}-\d{6}-[a-z0-9]{3}$/u);
  });

  test("it branches from the fetched remote, not from local HEAD", async () => {
    const { repo, home } = await repository();
    // A local commit that origin does not have. The new worktree must not have it.
    await writeFile(join(repo, "local.txt"), "only here\n");
    await runShell(repo, "git add -A && git commit -q -m local-only");
    const made = await create(repo, { description: "from origin", home });
    expect(await Bun.file(join(made.path, "local.txt")).exists()).toBe(false);
  });

  // `defaultBranch` falls back to a local ref, and that fallback used to be
  // unreachable: create fetched origin/<base> for a base git had resolved
  // locally, which can only fail. `glrs wt new` was impossible in any repo whose
  // remote was empty.
  test("a base that exists only locally is branched from, not fetched", async () => {
    const { repo, home } = await unpushed();
    const made = await create(repo, { description: "works offline", home });
    expect(made.base).toBe("main");
    expect(await Bun.file(join(made.path, "README.md")).text()).toBe("hello\n");
  });

  test("the remote still wins when it has the branch", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "from the remote", home });
    expect(made.base).toBe("origin/main");
  });

  test("neither remote nor local names both in the failure", async () => {
    const { repo, home } = await repository();
    await expect(create(repo, { description: "nope", from: "nonesuch", home })).rejects.toThrow(
      /no origin\/nonesuch and no local nonesuch/u,
    );
  });

  // The tool this replaces ran `git branch -D` on a collision, throwing away
  // whatever was on that branch.
  test("a name already taken is refused rather than overwritten", async () => {
    const { repo, home } = await repository();
    await create(repo, { description: "taken", home });
    expect(create(repo, { description: "taken", home })).rejects.toThrow("already exists");
  });

  test("no upstream is set, so the branch does not claim to be up to date with main", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "no upstream", home });
    const said = await runShell(
      made.path,
      "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}",
    );
    expect(said.ok).toBe(false);
  });
});

describe("the wt_new hook", () => {
  const hooked = async (body: string): Promise<{ path: string; note: string | null }> => {
    const { repo, home } = await repository();
    await mkdir(join(repo, ".glrs", "hooks"), { recursive: true });
    await writeFile(join(repo, ".glrs", "hooks", "wt_new"), `#!/bin/sh\n${body}\n`, {
      mode: 0o755,
    });
    await runShell(repo, "git add -A && git commit -q -m hook && git push -q origin main");
    const made = await create(repo, { description: "with a hook", home });
    return { path: made.path, note: made.note };
  };

  test("it runs in the new worktree, and is told where it is", async () => {
    const { path, note } = await hooked('echo "$WORKTREE_DIR" > ran.txt');
    expect(note).toBeNull();
    expect((await Bun.file(join(path, "ran.txt")).text()).trim()).toBe(path);
  });

  test("it gets the worktree as its first argument too", async () => {
    const { path } = await hooked('echo "$1" > arg.txt');
    expect((await Bun.file(join(path, "arg.txt")).text()).trim()).toBe(path);
  });

  test("it knows the repository name", async () => {
    const { path } = await hooked('echo "$REPO_NAME" > repo.txt');
    expect((await Bun.file(join(path, "repo.txt")).text()).trim()).toBe("repo");
  });

  // A hook that fails must not cost you the worktree — it is already there, and
  // whatever the hook was doing is usually rerunnable by hand.
  test("one that fails warns and leaves the worktree standing", async () => {
    const { path, note } = await hooked("exit 3");
    expect(note).toContain("wt_new failed");
    expect(await Bun.file(join(path, "README.md")).exists()).toBe(true);
  });
});

describe("listing and auditing", () => {
  test("git is the source of truth, so a hand-made worktree still shows", async () => {
    const { repo, home } = await repository();
    await create(repo, { description: "made by glrs", home });
    const byHand = join(home, "by-hand");
    await runShell(repo, `git worktree add -b by-hand ${JSON.stringify(byHand)} --quiet`);
    const found = await list(repo);
    expect(found.map((one) => one.branch).sort()).toEqual(["by-hand", "made-by-glrs", "main"]);
  });

  test("a worktree with a recent session is not safe to remove", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "in use", home });
    const [verdict] = await audit(repo, [{ cwd: made.path, updatedAt: new Date().toISOString() }]);
    expect(verdict?.safe).toBe(false);
    expect(verdict?.because.join(" ")).toContain("session");
  });

  // A session from months ago is history, not occupancy.
  test("an old session is reported but does not block", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "long done", home });
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [verdict] = await audit(repo, [{ cwd: made.path, updatedAt: old }]);
    expect(verdict?.session).not.toBeNull();
    expect(verdict?.because.join(" ")).not.toContain("session");
  });

  test("uncommitted work blocks removal and says how much", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "dirty", home });
    await writeFile(join(made.path, "scratch.txt"), "work in progress\n");
    const [verdict] = await audit(repo, []);
    expect(verdict?.dirty).toBe(1);
    expect(verdict?.because.join(" ")).toContain("uncommitted");
  });

  test("unpushed commits block removal", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "ahead", home });
    await runShell(made.path, "git config user.email a@b.c && git config user.name Test");
    await writeFile(join(made.path, "new.txt"), "x\n");
    await runShell(made.path, "git add -A && git commit -q -m ahead");
    const [verdict] = await audit(repo, []);
    expect(verdict?.unpushed).toBe(1);
    expect(verdict?.because.join(" ")).toContain("unpushed");
  });

  test("the main checkout is never offered up for removal", async () => {
    const { repo, home } = await repository();
    await create(repo, { description: "one", home });
    const verdicts = await audit(repo, []);
    expect(verdicts.map((one) => one.path)).not.toContain(repo);
  });
});

describe("removing one", () => {
  test("a clean worktree goes, and its branch with it", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "done with this", home });
    await remove(repo, made.path);
    expect(await Bun.file(join(made.path, "README.md")).exists()).toBe(false);
    expect((await list(repo)).map((one) => one.branch)).not.toContain("done-with-this");
  });

  test("a dirty one is refused, and says what to pass", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "busy", home });
    await writeFile(join(made.path, "scratch.txt"), "work\n");
    expect(remove(repo, made.path)).rejects.toThrow("--force");
  });

  test("--force removes it anyway", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "forced", home });
    await writeFile(join(made.path, "scratch.txt"), "work\n");
    await remove(repo, made.path, { force: true });
    expect(await Bun.file(join(made.path, "scratch.txt")).exists()).toBe(false);
  });

  // The tool this replaces used the safe delete and swallowed the failure, so an
  // unmerged branch quietly outlived its worktree with nothing to say so.
  test("an unmerged branch is kept, and said out loud", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "unmerged work", home });
    await runShell(made.path, "git config user.email a@b.c && git config user.name Test");
    await writeFile(join(made.path, "new.txt"), "x\n");
    await runShell(made.path, "git add -A && git commit -q -m unmerged");
    const notes = await remove(repo, made.path, { force: true });
    expect(notes.join(" ")).toContain("not merged");
    expect(notes.join(" ")).toContain("git branch -D unmerged-work");
  });
});

describe("hook discovery", () => {
  test("no hook at all is not a problem", async () => {
    const { repo, home } = await repository();
    const made = await create(repo, { description: "no hook here", home });
    expect(await runNewHook(made.path, "repo")).toBeNull();
  });
});
