import { access, constants, mkdir, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runShell, type ShellResult } from "../../../glrs-core/src/shell";

// Every worktree operation, as functions over a command runner. The CLI
// subcommands and the slash commands are both thin wrappers around this, so the
// two cannot drift into meaning different things.
//
// Reimplemented rather than shelled out to, because glrs knows one thing the
// standalone tool cannot: which worktrees have sessions in them. See `audit`.

export type Exec = (dir: string, command: string) => Promise<ShellResult>;

const shell: Exec = (dir, command) => runShell(dir, command);

// Branches nobody should be cleaning up, whatever the checks say.
const PROTECTED = new Set(["main", "master", "next", "prerelease"]);

// A session this recent means somebody is probably still working there. Older
// than this and it is reported but does not block removal — a session from
// three months ago is history, not occupancy.
const ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;

export type Worktree = {
  path: string;
  branch: string;
  head: string;
};

export type Verdict = Worktree & {
  /** Most recent session recorded in this directory, if any. */
  session: { updatedAt: string; ageMs: number } | null;
  dirty: number;
  unpushed: number;
  merged: boolean;
  remoteGone: boolean;
  protected: boolean;
  safe: boolean;
  /** Why it is not safe, in the order a person would want to hear it. */
  because: string[];
};

// ── identity ────────────────────────────────────────────────────────────────

// The main checkout, from anywhere inside it — including from inside one of its
// own worktrees, where `--show-toplevel` would answer with the worktree.
export const mainRepo = async (cwd: string, exec: Exec = shell): Promise<string> => {
  const said = await exec(cwd, "git rev-parse --git-common-dir");
  if (!said.ok) throw new Error(`not a git repository: ${cwd}`);
  const common = said.stdout.trim();
  const found = dirname(resolve(cwd, common));
  // Through realpath, because `git worktree list` reports real paths: on macOS
  // /var is a symlink to /private/var, so the same directory compares unequal
  // depending on who named it. That mismatch made `audit` fail to recognise the
  // main checkout and report it as a removable worktree on a protected branch.
  return realpath(found).catch(() => found);
};

export const repoName = async (cwd: string, exec: Exec = shell): Promise<string> =>
  basename(await mainRepo(cwd, exec));

// Where worktrees live. The environment overrides are the ones the tool this
// replaces honoured, so an existing layout keeps working.
export const worktreesRoot = (repo: string, home = homedir()): string => {
  const override = process.env.GLRS_DIR ?? process.env.GLORIOUS_DIR;
  return override ? resolve(override, repo) : join(home, ".glrs", "worktrees", repo);
};

// ── naming ──────────────────────────────────────────────────────────────────

// A description becomes the branch *and* the directory. The tool this replaces
// always auto-named and left you to rename the branch afterwards, which is why
// every worktree on this machine is `wt-260816-113432-8s8` on a branch called
// something else entirely.
export const slug = (description: string): string =>
  description
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 50)
    .replace(/-+$/gu, "");

// Local time, matching the old layout so a directory listing stays sorted the
// way it always has. The suffix is three random base36 characters, which is what
// keeps two worktrees made in the same second apart.
export const autoName = (
  now = new Date(),
  suffix = Math.random().toString(36).slice(2, 5),
): string => {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  const date = `${now.getFullYear().toString().slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `wt-${date}-${time}-${suffix.padEnd(3, "0")}`;
};

// ── reading ─────────────────────────────────────────────────────────────────

// `git worktree list --porcelain` rather than a directory scan or a registry
// file. The tool this replaces kept a registry, which self-rewrote on every read
// and — once it had any entry — stopped falling back to git, so a worktree made
// with plain `git worktree add` was invisible to it forever.
export const list = async (cwd: string, exec: Exec = shell): Promise<Worktree[]> => {
  const said = await exec(cwd, "git worktree list --porcelain");
  if (!said.ok) return [];
  const found: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of `${said.stdout}\n`.split("\n")) {
    if (line.startsWith("worktree ")) current = { path: line.slice(9).trim() };
    else if (line.startsWith("HEAD ")) current.head = line.slice(5).trim();
    else if (line.startsWith("branch "))
      current.branch = line
        .slice(7)
        .trim()
        .replace(/^refs\/heads\//u, "");
    else if (line.trim() === "" && current.path !== undefined) {
      found.push({
        path: current.path,
        branch: current.branch ?? "(detached)",
        head: current.head ?? "",
      });
      current = {};
    }
  }
  return found;
};

// Every repo that has worktrees, for the cross-repo view. Directories only —
// this is a listing, and asking git about each one would mean finding each one's
// checkout first.
export const listAll = async (home = homedir()): Promise<Array<{ repo: string; path: string }>> => {
  const base = process.env.GLRS_DIR ?? process.env.GLORIOUS_DIR ?? join(home, ".glrs", "worktrees");
  const repos = await readdir(base, { withFileTypes: true }).catch(() => []);
  const found: Array<{ repo: string; path: string }> = [];
  for (const repo of repos) {
    if (!repo.isDirectory()) continue;
    const inside = await readdir(join(base, repo.name), { withFileTypes: true }).catch(() => []);
    for (const one of inside)
      if (one.isDirectory()) found.push({ repo: repo.name, path: join(base, repo.name, one.name) });
  }
  return found;
};

// The branch a worktree should be measured against. First answer wins, which is
// the order git itself would resolve it in.
export const defaultBranch = async (repo: string, exec: Exec = shell): Promise<string> => {
  const head = await exec(repo, "git symbolic-ref refs/remotes/origin/HEAD");
  if (head.ok && head.stdout.trim() !== "")
    return head.stdout.trim().replace(/^refs\/remotes\/origin\//u, "");
  for (const candidate of ["refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    const found = await exec(repo, `git show-ref --verify --quiet ${candidate}`);
    if (found.ok) return candidate.split("/").pop() ?? "main";
  }
  for (const candidate of ["refs/heads/main", "refs/heads/master"]) {
    const found = await exec(repo, `git show-ref --verify --quiet ${candidate}`);
    if (found.ok) return candidate.split("/").pop() ?? "main";
  }
  throw new Error(
    "cannot work out the default branch — set it with: git remote set-head origin <branch>",
  );
};

// ── creating ────────────────────────────────────────────────────────────────

// A project can put an executable at .glrs/hooks/wt_new to do whatever a fresh
// worktree needs — install dependencies, copy a .env across. The contract is
// exactly the one the tool this replaces used, so existing hooks keep working:
// the worktree directory as the single argument, WORKTREE_DIR and REPO_NAME in
// the environment, and a failure that warns rather than aborting.
export const runNewHook = async (
  worktree: string,
  repo: string,
  exec: Exec = shell,
): Promise<string | null> => {
  for (const dir of [".glrs", ".glorious"]) {
    const hook = join(worktree, dir, "hooks", "wt_new");
    const usable = await access(hook, constants.X_OK).then(
      () => true,
      () => false,
    );
    if (!usable) continue;
    // `env` rather than a bare assignment prefix so the variables survive however
    // the runner invokes this, and no `timeout` — that is GNU coreutils and is
    // not on macOS. The runner's own timeout applies instead.
    const said = await exec(
      worktree,
      `env WORKTREE_DIR=${JSON.stringify(worktree)} REPO_NAME=${JSON.stringify(repo)} ` +
        `${JSON.stringify(hook)} ${JSON.stringify(worktree)}`,
    );
    return said.ok
      ? null
      : `hook ${dir}/hooks/wt_new failed: ${said.stderr.trim() || `exit ${said.code}`}`;
  }
  return null;
};

export type Created = { path: string; branch: string; base: string; note: string | null };

export const create = async (
  cwd: string,
  options: { description?: string; from?: string; home?: string } = {},
  exec: Exec = shell,
): Promise<Created> => {
  const repo = await mainRepo(cwd, exec);
  const name = options.description === undefined ? "" : slug(options.description);
  const branch = name === "" ? autoName() : name;
  const root = worktreesRoot(basename(repo), options.home);
  const path = join(root, branch);

  const base = options.from ?? (await defaultBranch(repo, exec));

  // Refused rather than force-deleted. The tool this replaces ran `git branch -D`
  // on a collision, which throws away whatever was on that branch.
  const exists = await exec(repo, `git show-ref --verify --quiet refs/heads/${branch}`);
  if (exists.ok) throw new Error(`branch ${branch} already exists — pick another description`);

  const fetched = await exec(repo, `git fetch origin ${base} --quiet`);
  if (!fetched.ok) throw new Error(`could not fetch origin/${base}: ${fetched.stderr.trim()}`);

  await mkdir(root, { recursive: true });
  // --no-track is what actually leaves the upstream unset. Branching from a
  // remote-tracking start point sets one automatically (branch.autoSetupMerge),
  // which is why the tool this replaces appeared to need an explicit
  // --set-upstream-to: git had already pointed it at origin/<base>, so a branch
  // reported "up to date with origin/main" however far it had diverged.
  const added = await exec(
    repo,
    `git worktree add --no-track -b ${branch} ${JSON.stringify(path)} origin/${base} --quiet`,
  );
  if (!added.ok) throw new Error(`could not create the worktree: ${added.stderr.trim()}`);

  // Deliberately no upstream. The tool this replaces set it to origin/<base>, so
  // a fresh branch reported "up to date with origin/main" however far it had
  // diverged. `git push -u` sets the right one when you first push.
  const note = await runNewHook(path, basename(repo), exec);
  return { path, branch, base, note };
};

// ── auditing ────────────────────────────────────────────────────────────────

// Two names for the same directory. A session records whatever `process.cwd()`
// gave it and git reports a real path, so on any machine where a parent is a
// symlink — /var on macOS, /home on some Linux setups — the same worktree
// compares unequal and a session in it goes unnoticed. That failure is silent
// and in the direction that deletes work.
const sameDirectory = async (a: string, b: string): Promise<boolean> => {
  if (resolve(a) === resolve(b)) return true;
  const [left, right] = await Promise.all([
    realpath(a).catch(() => resolve(a)),
    realpath(b).catch(() => resolve(b)),
  ]);
  return left === right;
};

const countLines = (text: string): number =>
  text.split("\n").filter((line) => line.trim() !== "").length;

// What glrs knows that the tool it replaces could not: whether anybody has been
// working in a worktree. Sessions record the directory they ran in.
export const audit = async (
  cwd: string,
  sessions: ReadonlyArray<{ cwd: string; updatedAt: string }>,
  now = Date.now(),
  exec: Exec = shell,
): Promise<Verdict[]> => {
  const repo = await mainRepo(cwd, exec);
  const base = await defaultBranch(repo, exec).catch(() => "main");
  const worktrees = await list(cwd, exec);
  const verdicts: Verdict[] = [];

  for (const tree of worktrees) {
    // The main checkout is not a worktree anybody cleans up.
    if (await sameDirectory(tree.path, repo)) continue;

    const here: Array<{ cwd: string; updatedAt: string }> = [];
    for (const one of sessions) if (await sameDirectory(one.cwd, tree.path)) here.push(one);
    const latest = here.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const session =
      latest === undefined
        ? null
        : { updatedAt: latest.updatedAt, ageMs: now - Date.parse(latest.updatedAt) };

    const status = await exec(tree.path, "git status --porcelain");
    const dirty = status.ok ? countLines(status.stdout) : 0;

    const hasRemote = (
      await exec(repo, `git show-ref --verify --quiet refs/remotes/origin/${tree.branch}`)
    ).ok;
    // Measured against its own remote branch, not against the base. The tool
    // this replaces diffed against origin/<base>, so a branch fully pushed to
    // its own remote still counted as unpushed and was skipped forever.
    const ahead = hasRemote
      ? await exec(tree.path, `git log --oneline origin/${tree.branch}..HEAD`)
      : await exec(tree.path, `git log --oneline origin/${base}..HEAD`);
    const unpushed = ahead.ok ? countLines(ahead.stdout) : 0;

    const merged = (
      await exec(repo, `git merge-base --is-ancestor refs/heads/${tree.branch} origin/${base}`)
    ).ok;
    const guarded = PROTECTED.has(tree.branch);
    const active = session !== null && session.ageMs < ACTIVE_MS;

    const because: string[] = [];
    if (guarded) because.push("protected branch");
    if (active) because.push("a session was working here recently");
    if (dirty > 0) because.push(`${dirty} uncommitted change${dirty === 1 ? "" : "s"}`);
    if (unpushed > 0) because.push(`${unpushed} unpushed commit${unpushed === 1 ? "" : "s"}`);
    if (!merged && hasRemote) because.push("not merged into the base branch");

    verdicts.push({
      ...tree,
      session,
      dirty,
      unpushed,
      merged,
      remoteGone: !hasRemote,
      protected: guarded,
      safe: because.length === 0,
      because,
    });
  }
  return verdicts;
};

// ── removing ────────────────────────────────────────────────────────────────

export const remove = async (
  cwd: string,
  path: string,
  options: { force?: boolean } = {},
  exec: Exec = shell,
): Promise<string[]> => {
  const repo = await mainRepo(cwd, exec);
  const notes: string[] = [];
  const removed = await exec(
    repo,
    `git worktree remove ${options.force ? "--force " : ""}${JSON.stringify(path)}`,
  );
  if (!removed.ok)
    throw new Error(
      `could not remove ${path}: ${removed.stderr.trim() || "it may have uncommitted changes — pass --force"}`,
    );

  const branch = basename(path);
  const deleted = await exec(repo, `git branch -d ${branch}`);
  // Said rather than swallowed. The tool this replaces used the safe delete and
  // ignored the failure, so an unmerged branch quietly outlived its worktree
  // with nothing to tell you it was still there.
  if (!deleted.ok)
    notes.push(`branch ${branch} kept — it is not merged; delete it with: git branch -D ${branch}`);
  return notes;
};
