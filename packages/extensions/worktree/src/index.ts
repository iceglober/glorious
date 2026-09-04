import type { Glrs } from "../../../glrs-core/src";
import { listSessions } from "../../../glrs-core/src/session";
import { audit, create, list, listAll, remove, type Verdict } from "./worktree";

// Worktrees, as something you run and something the agent knows how to use.
//
// This exists rather than being a wrapper around a standalone tool because glrs
// knows one thing such a tool cannot: which worktrees have sessions in them.
// `wt doctor` is the whole argument — everything else here is table stakes.
//
// Every verb is reachable two ways, and both go through the same functions in
// worktree.ts so they cannot come to mean different things:
//   glrs wt <verb>   — you, at a terminal, with no session running
//   /wt <verb>       — you or the agent, mid-session

// What this session created, remembered in the session itself so a resumed one
// still knows. `appendEntry` writes an event the model never sees, which is what
// keeps a growing list of paths out of the context.
type Tracked = { path: string; branch: string; createdAt: string };

const ENTRY = "worktree";

const ago = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const verdictLine = (one: Verdict): string => {
  const where = one.session === null ? "no session" : `active ${ago(one.session.ageMs)}`;
  const why = one.safe ? "safe to remove" : one.because.join(" · ");
  return `${one.branch}\n    ${one.path}\n    ${where} · ${why}`;
};

export default function worktree(g: Glrs): void {
  const tracked = (): Tracked[] => (g.entries(ENTRY) as Tracked[]) ?? [];

  const report = async (): Promise<string> => {
    const verdicts = await audit(g.root, await listSessions());
    if (verdicts.length === 0) return "No worktrees for this repository.";
    return verdicts.map(verdictLine).join("\n");
  };

  const listing = async (all: boolean): Promise<string> => {
    if (all) {
      const found = await listAll();
      return found.length === 0
        ? "No worktrees anywhere."
        : found.map((one) => `${one.repo}  ${one.path}`).join("\n");
    }
    const found = await list(g.root);
    return found.length === 0
      ? "No worktrees."
      : found.map((one) => `${one.branch}  ${one.path}`).join("\n");
  };

  // The path, and a warning only when there is one. `create` returns a note
  // solely when the wt_new hook failed, so on the ordinary path there is nothing
  // to say beyond where the worktree is: the branch is the directory's name and
  // the base is the default.
  const made = async (
    args: readonly string[],
  ): Promise<{ path: string; warning: string | null; entry: Tracked }> => {
    const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : undefined;
    const description = args.filter((one) => !one.startsWith("--") && one !== from).join(" ");
    const built = await create(g.root, {
      description: description === "" ? undefined : description,
      from,
    });
    return {
      path: built.path,
      warning: built.note,
      entry: { path: built.path, branch: built.branch, createdAt: new Date().toISOString() },
    };
  };

  // ── the executable ────────────────────────────────────────────────────────

  g.cli("wt", {
    description: "Create, audit and clean git worktrees",
    async run(args) {
      const [verb = "list", ...rest] = args;
      if (verb === "new" || verb === "create") {
        const { path, warning } = await made(rest);
        // One line, so `cd $(glrs wt new)` works and so reading it is the same
        // as capturing it. A failed hook is the only thing that ever interrupts
        // that, and it goes to stderr because it is not the answer.
        g.print(path);
        if (warning !== null) process.stderr.write(`${warning}\n`);
        return;
      }
      if (verb === "list" || verb === "ls") return g.print(await listing(rest.includes("--all")));
      if (verb === "doctor") return g.print(await report());
      if (verb === "rm" || verb === "delete") {
        const name = rest.find((one) => !one.startsWith("--"));
        if (name === undefined) throw new Error("which one? glrs wt rm <branch>");
        const found = (await list(g.root)).find(
          (one) => one.branch === name || one.path.endsWith(`/${name}`),
        );
        if (found === undefined) throw new Error(`no worktree called ${name}`);
        for (const note of await remove(g.root, found.path, { force: rest.includes("--force") }))
          g.print(note);
        g.print(`removed ${found.path}`);
        return;
      }
      if (verb === "clean") {
        const verdicts = await audit(g.root, await listSessions());
        const safe = verdicts.filter((one) => one.safe);
        if (safe.length === 0) return g.print("Nothing is safe to remove.");
        if (rest.includes("--dry-run"))
          return g.print(safe.map((one) => `would remove ${one.path}`).join("\n"));
        // No prompt: a subcommand has no session and no way to ask. --dry-run
        // first is the safe habit, and doctor says the same thing in more detail.
        if (!rest.includes("--yes"))
          return g.print(
            `${safe.length} worktree(s) are safe to remove. Re-run with --yes, or see them with --dry-run.`,
          );
        for (const one of safe) {
          for (const note of await remove(g.root, one.path)) g.print(note);
          g.print(`removed ${one.path}`);
        }
        return;
      }
      throw new Error(`unknown: glrs wt ${verb}. Try new, list, doctor, rm or clean.`);
    },
  });

  // ── inside a session ──────────────────────────────────────────────────────

  g.command("wt", {
    description: "Create, audit and clean git worktrees",
    async run(args) {
      const [verb = "list", ...rest] = args
        .trim()
        .split(/\s+/u)
        .filter((one) => one !== "");
      try {
        if (verb === "new" || verb === "create") {
          const { path, warning, entry } = await made(rest);
          // Recorded here and not in the subcommand: a subcommand has no session
          // to record into. `wt doctor` covers that case from the other side, by
          // correlating against every session's directory.
          g.appendEntry(ENTRY, entry);
          if (warning !== null) g.print(warning, "warning");
          return g.print(path);
        }
        if (verb === "list" || verb === "ls") return g.print(await listing(rest.includes("--all")));
        if (verb === "doctor") return g.print(await report());
        g.print(
          `Unknown: /wt ${verb}. Try new, list or doctor, removal is \`glrs wt rm\`.`,
          "warning",
        );
      } catch (thrown) {
        g.print(thrown instanceof Error ? thrown.message : String(thrown), "danger");
      }
    },
  });

  // Rendered fresh each turn, so a worktree made three turns ago is still in
  // front of the model — and nothing at all is said in a session that never
  // made one.
  g.prompt(() => {
    const open = tracked();
    if (open.length === 0) return "";
    return [
      "Worktrees this session created:",
      ...open.map((one) => `- ${one.branch}, ${one.path}`),
      "Work in them with absolute paths, or `bash cd <path> && …`. This session's own root is",
      "unchanged, so a relative path still resolves against the directory glrs was started in.",
    ].join("\n");
  });
}
