/**
 * Does the agent actually do the job?
 *
 * Twice in this example's history a change was built on one observed failure
 * that turned out not to reproduce. A model's output varies run to run, so a
 * single success proves nothing and a single failure proves nothing either;
 * the only honest way to know whether a change helped is to run a fixed set of
 * tasks several times and compare rates.
 *
 * Each fixture is a directory to copy, a goal to give, and a shell check that
 * decides the outcome — no model judges the result, so the score means the
 * same thing every time.
 *
 *   bun activegraph/examples/eval/run-eval.ts [runs-per-task] [task-name…]
 */

import { Database } from "bun:sqlite";
import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Task {
  readonly name: string;
  readonly goal: string;
  readonly check: string;
  /**
   * The status the task must end in. Set it to "failed" for a goal that cannot
   * be done: the interesting question there is not what the agent changed but
   * whether it admits the work did not happen, and a filesystem check cannot
   * tell an honest report from a confident one.
   */
  readonly expectStatus?: "completed" | "failed";
}

const FIXTURE_SUFFIX = ".fixture";

const here = import.meta.dir;
const runner = join(here, "..", "run-coding-agent.ts");
const fixtures = join(here, "fixtures");

const load = (): readonly Task[] =>
  readdirSync(fixtures, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      ...(JSON.parse(readFileSync(join(fixtures, entry.name, "task.json"), "utf8")) as Omit<
        Task,
        "name"
      >),
    }));

/** The status the agent settled its last task on, read back from the log. */
const finalStatus = (dbPath: string): string => {
  const db = new Database(dbPath, { readonly: true });
  try {
    const status = new Map<string, string>();
    for (const row of db.query("select body from events order by id").all() as { body: string }[]) {
      const event = JSON.parse(row.body) as {
        type: string;
        payload: {
          objectType?: string;
          objectId?: string;
          data?: { status?: string };
          patch?: { status?: string };
        };
      };
      if (event.payload.objectType !== "task" || event.payload.objectId === undefined) continue;
      const next = event.payload.data?.status ?? event.payload.patch?.status;
      if (next !== undefined) status.set(event.payload.objectId, next);
    }
    return [...status.values()].at(-1) ?? "(no task)";
  } finally {
    db.close();
  }
};

const shell = (command: string, cwd: string): boolean =>
  Bun.spawnSync(["bash", "-lc", command], { cwd, stdout: "ignore", stderr: "ignore" }).exitCode ===
  0;

interface Attempt {
  readonly passed: boolean;
  readonly seconds: number;
  /** Kept when the attempt was interesting, so there is something to look at. */
  readonly kept?: string;
}

/**
 * Above this, an attempt is worth keeping even though it passed. Runs of this
 * shape cluster around ten seconds; the occasional one takes minutes, and
 * whether that is a command sitting on its timeout, a slow provider, or extra
 * review rounds is not a question an average can answer.
 */
const SLOW_SECONDS = 60;

/**
 * One attempt: a clean copy of the fixture, one goal, then the check.
 *
 * A passing attempt leaves nothing behind. A failing one keeps its directory
 * and its event log, because a score with no evidence is a scoreboard rather
 * than a diagnosis — and the log replays, so the failure can be examined
 * without spending another call.
 */
const attempt = async (task: Task): Promise<Attempt> => {
  const dir = mkdtempSync(join(tmpdir(), `eval-${task.name}-`));
  cpSync(join(fixtures, task.name, "files"), dir, { recursive: true });
  // A fixture's tests are data, not this repository's tests — one of them is
  // meant to fail — so they are stored with a suffix that `bun test` ignores
  // and given their real names on the way into the copy.
  for (const path of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (path.endsWith(FIXTURE_SUFFIX)) {
      renameSync(join(dir, path), join(dir, path.slice(0, -FIXTURE_SUFFIX.length)));
    }
  }
  const began = Bun.nanoseconds();
  Bun.spawnSync(["bun", runner, task.goal], {
    cwd: dir,
    env: { ...process.env, ACTIVEGRAPH_DB: join(dir, "eval.db") },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const seconds = (Bun.nanoseconds() - began) / 1e9;
  const settled =
    task.expectStatus === undefined || finalStatus(join(dir, "eval.db")) === task.expectStatus;
  const passed = settled && shell(task.check, dir);
  const interesting = !passed || seconds > SLOW_SECONDS;
  if (!interesting) rmSync(dir, { recursive: true, force: true });
  return interesting ? { passed, seconds, kept: dir } : { passed, seconds };
};

const runs = Number(process.argv[2] ?? 2);
const only = new Set(process.argv.slice(3));
const tasks = load().filter((task) => only.size === 0 || only.has(task.name));

console.log(
  `${tasks.length} task(s) × ${runs} run(s), checked by shell, no model judges the result\n`,
);
let passes = 0;
let total = 0;
for (const task of tasks) {
  const results: Attempt[] = [];
  for (let run = 0; run < runs; run += 1) {
    const outcome = await attempt(task);
    results.push(outcome);
    process.stdout.write(outcome.passed ? "." : "x");
  }
  const won = results.filter((result) => result.passed).length;
  const times = results.map((result) => result.seconds);
  const elapsed = times.reduce((sum, seconds) => sum + seconds, 0);
  passes += won;
  total += results.length;
  // The worst run, not only the mean: one attempt in ten takes minutes, and an
  // average over three hides it inside a plausible-looking number.
  console.log(
    ` ${task.name}: ${won}/${results.length}` +
      ` (${(elapsed / results.length).toFixed(0)}s avg, ${Math.max(...times).toFixed(0)}s worst)`,
  );
  for (const kept of results.filter((result) => result.kept !== undefined)) {
    console.log(
      `    ${kept.passed ? "slow" : "failed"} (${kept.seconds.toFixed(0)}s): ${kept.kept}`,
    );
  }
}
console.log(`\ntotal: ${passes}/${total}`);
process.exit(passes === total ? 0 : 1);
