import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliUsage, runCli, subcommandOf } from "./cli";

// The third way glrs runs. A subcommand loads the extensions, is handed its
// arguments and exits — no session, no model, no screen.

const roots: string[] = [];

const project = async (extension?: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glrs-cli-"));
  roots.push(root);
  if (extension !== undefined) {
    await mkdir(join(root, ".glrs", "extensions"), { recursive: true });
    await Bun.write(join(root, ".glrs", "extensions", "probe.ts"), extension);
  }
  return root;
};

// stdout is where a subcommand writes, so reading it back is how these assert.
const capturing = async (run: () => Promise<unknown>): Promise<string> => {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };
  try {
    await run();
  } finally {
    (process.stdout as { write: unknown }).write = original;
  }
  return written.join("");
};

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("dispatching to a subcommand an extension added", () => {
  test("it runs, and gets everything after its own name", async () => {
    const root = await project(`export default function (g) {
      g.cli("wt", {
        description: "worktrees",
        run: (args) => g.print(\`ran with [\${args.join(",")}]\`),
      });
    }`);
    const out = await capturing(() => runCli("wt", ["list", "--all"], { root }));
    expect(out).toContain("ran with [list,--all]");
  });

  test("a word nobody registered is not handled, and says what does exist", async () => {
    const root = await project(`export default function (g) {
      g.cli("wt", { description: "manage worktrees", run: () => {} });
    }`);
    const outcome = await runCli("nope", [], { root });
    expect(outcome.handled).toBe(false);
    // The caller writes the error, but the material for it comes from here —
    // the extensions are loaded by this point and asking them is free.
    expect(cliUsage(outcome.available)).toContain("glrs wt");
    expect(cliUsage(outcome.available)).toContain("manage worktrees");
  });

  test("with no extensions at all, nothing is handled and nothing is offered", async () => {
    const root = await project();
    const outcome = await runCli("wt", [], { root });
    expect(outcome.handled).toBe(false);
    expect(cliUsage(outcome.available)).toBe("");
  });

  // The point of the separate host: a subcommand has no session, and the
  // members that need one say so rather than returning something plausible.
  test("reaching for the model says why it is not there", async () => {
    const root = await project(`export default function (g) {
      g.cli("boom", {
        description: "d",
        run: () => {
          try {
            g.model();
          } catch (thrown) {
            g.print(String(thrown.message));
          }
        },
      });
    }`);
    const out = await capturing(() => runCli("boom", [], { root }));
    expect(out).toContain("needs a session");
    expect(out).toContain("g.model()");
  });

  test("what a subcommand can reach is git, the filesystem and stdout", async () => {
    const root = await project(`export default function (g) {
      g.cli("probe", {
        description: "d",
        run: async () => {
          const { stdout } = await g.exec("echo from-a-subcommand");
          g.print(\`root=\${g.root.length > 0} exec=\${stdout.trim()}\`);
        },
      });
    }`);
    const out = await capturing(() => runCli("probe", [], { root }));
    expect(out).toContain("root=true");
    expect(out).toContain("exec=from-a-subcommand");
  });

  test("a subcommand that throws lets the failure travel", async () => {
    const root = await project(`export default function (g) {
      g.cli("bad", { description: "d", run: () => { throw new Error("no good"); } });
    }`);
    expect(runCli("bad", [], { root })).rejects.toThrow("no good");
  });
});

describe("what --help says an extension added", () => {
  test("nothing at all when no extension added a subcommand", () => {
    expect(cliUsage([])).toBe("");
  });

  test("each one on its own line, names aligned", () => {
    const said = cliUsage([
      ["wt", { description: "manage worktrees" }],
      ["deploy", { description: "ship it" }],
    ]);
    expect(said).toContain("glrs wt");
    expect(said).toContain("glrs deploy");
    // Aligned on the longest name, so the descriptions form a column.
    expect(said).toContain("glrs wt     ");
  });
});

// Which word is the subcommand. Scanning argv for a known word anywhere meant
// `glrs wt doctor` ran glrs's own doctor and the extension never saw it — a
// subcommand's arguments are not glrs's to interpret.
describe("picking the subcommand out of argv", () => {
  const firstBareWord = (args: string[]): string | undefined => subcommandOf(args)?.name;

  test("the first bare word wins, and its own arguments are left alone", () => {
    expect(subcommandOf(["wt", "doctor"])).toEqual({ name: "wt", rest: ["doctor"] });
    expect(subcommandOf(["wt", "new", "fix the thing"])).toEqual({
      name: "wt",
      rest: ["new", "fix the thing"],
    });
  });

  test("a flag's value is not mistaken for it", () => {
    expect(firstBareWord(["--model", "azure/x", "doctor"])).toBe("doctor");
    expect(firstBareWord(["--model", "azure/x"])).toBeUndefined();
  });

  test("glrs's own words still resolve to glrs", () => {
    expect(firstBareWord(["doctor"])).toBe("doctor");
    expect(firstBareWord(["doctor", "--json"])).toBe("doctor");
  });

  test("nothing bare at all is not a subcommand", () => {
    expect(firstBareWord([])).toBeUndefined();
    expect(firstBareWord(["--resume"])).toBeUndefined();
  });
});
