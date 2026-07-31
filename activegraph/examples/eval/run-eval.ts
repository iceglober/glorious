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
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteEventStore } from "../../adapters/sqlite-event-store";
import { replayStrict } from "../../shell/replay";
import {
  type CodingAgentSchema,
  codingAgentSchema,
  createCodingAgentBehaviors,
} from "../coding-agent";
import { summarizeRun } from "../run-summary";

interface Task {
  readonly name: string;
  /** One goal, or a sequence run against the same directory and log. */
  readonly goal?: string;
  readonly goals?: readonly string[];
  /**
   * Feed the goals to a single invocation instead of one each. That is the
   * session loop, which is otherwise runner code no test reaches: a goal
   * prompt, a goal, and the next goal seeing what the last one did without a
   * process restart.
   */
  readonly session?: boolean;
  readonly check: string;
  /**
   * Most calls a run of this task may make. A behavior that fires twice where
   * it should fire once doubles the bill and changes nothing observable — the
   * duplicate review that shipped in this example was caught by a unit test
   * counting responses, which is luck rather than a method.
   *
   * Set it to about twice the usual count. These are doubling-detectors, not
   * behaviour pins: a review round or a refused command that gets a second
   * proposal is ordinary, and a budget of typical-plus-one fails on it.
   */
  readonly maxCalls?: number;
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

/**
 * Whether the run died because the provider could not be reached.
 *
 * That is the environment failing, not the agent: scoring it as a failed task
 * quietly depresses the pass rate, and the log cannot replay either, because
 * replay serves completions from the recording and a request that never got an
 * answer left none. Both would otherwise read as regressions.
 */
const unreachableProvider = (dbPath: string): boolean => {
  if (!existsSync(dbPath)) return false;
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db
        .query("select body from events where type = 'behavior.failed'")
        .all()
        .filter((row) => (row as { body: string }).body.includes("provider_error")).length > 0
    );
  } finally {
    db.close();
  }
};

/** What the run spent, from the usage the adapter recorded in the log. */
const cost = async (
  dbPath: string,
): Promise<{ tokensIn: number; tokensOut: number; calls: number }> => {
  if (!existsSync(dbPath)) return { tokensIn: 0, tokensOut: 0, calls: 0 };
  const store = createSqliteEventStore<CodingAgentSchema>(dbPath);
  try {
    const log = await store.read({ branch: "main" });
    if (!log.ok) return { tokensIn: 0, tokensOut: 0, calls: 0 };
    const summary = summarizeRun(log.value);
    return {
      tokensIn: summary.inputTokens,
      tokensOut: summary.outputTokens,
      calls: summary.llmCalls,
    };
  } finally {
    store.close();
  }
};

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

/**
 * Whether the log this attempt wrote replays from itself, with no arguments.
 *
 * Every task is a determinism check for free: replay serves completions from
 * the recording, so it costs nothing and reaches no provider. Doing it by hand
 * is what caught settings living in a constructor argument, which made every
 * approval-gated log on disk unreplayable while the unit tests stayed green.
 */
const replays = async (dbPath: string): Promise<boolean> => {
  if (!existsSync(dbPath)) return false;
  const store = createSqliteEventStore<CodingAgentSchema>(dbPath);
  try {
    const verdict = await replayStrict({
      schema: codingAgentSchema,
      behaviors: createCodingAgentBehaviors(),
      store,
      branch: "main",
    });
    return verdict.ok;
  } finally {
    store.close();
  }
};

const shell = (command: string, cwd: string, expected: string): boolean =>
  Bun.spawnSync(["bash", "-lc", command], {
    cwd,
    env: { ...process.env, EXPECTED: expected },
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0;

interface Attempt {
  readonly passed: boolean;
  /** Whether the branch this run wrote re-derives from itself. */
  readonly replays: boolean;
  readonly seconds: number;
  /** Provider tokens the run spent, read back off its own log. */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly calls: number;
  /** The provider could not be reached, so this attempt measured nothing. */
  readonly unreachable: boolean;
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
  const goals = task.goals ?? [task.goal ?? ""];
  // Anything a check needs to compare against is scaffolding, not part of the
  // task: left in place it shows up in the agent's own directory listing, and
  // one run duly read the answer key. Moved aside, and handed to the check as
  // $EXPECTED.
  const expected = `${dir}-expected`;
  mkdirSync(expected, { recursive: true });
  for (const path of readdirSync(dir)) {
    if (path.startsWith(".expected-")) {
      renameSync(join(dir, path), join(expected, path.slice(".expected-".length)));
    }
  }

  // A fixture's tests are data, not this repository's tests — one of them is
  // meant to fail — so they are stored with a suffix that `bun test` ignores
  // and given their real names on the way into the copy.
  for (const path of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (path.endsWith(FIXTURE_SUFFIX)) {
      renameSync(join(dir, path), join(dir, path.slice(0, -FIXTURE_SUFFIX.length)));
    }
  }
  const began = Bun.nanoseconds();
  const env = { ...process.env, ACTIVEGRAPH_DB: join(dir, "eval.db") };
  if (task.session === true) {
    // One process, goals typed one after another; the blank line ends it.
    Bun.spawnSync(["bun", runner], {
      cwd: dir,
      env,
      stdin: new TextEncoder().encode(`${goals.join("\n")}\n\n`),
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    // Separate invocations against one log: the path a second goal in the same
    // directory really takes, and the only way its memory of the first is
    // tested rather than assumed.
    for (const goal of goals) {
      Bun.spawnSync(["bun", runner, goal], {
        cwd: dir,
        env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
    }
  }
  const seconds = (Bun.nanoseconds() - began) / 1e9;
  const spentEarly = await cost(join(dir, "eval.db"));
  const settled =
    task.expectStatus === undefined || finalStatus(join(dir, "eval.db")) === task.expectStatus;
  const withinBudget = task.maxCalls === undefined || spentEarly.calls <= task.maxCalls;
  const passed = settled && withinBudget && shell(task.check, dir, expected);
  const replayed = await replays(join(dir, "eval.db"));
  const spent = spentEarly;
  const unreachable = unreachableProvider(join(dir, "eval.db"));
  const interesting = !unreachable && (!passed || !replayed || seconds > SLOW_SECONDS);
  rmSync(expected, { recursive: true, force: true });
  if (!interesting) rmSync(dir, { recursive: true, force: true });
  return interesting
    ? { passed, replays: replayed, seconds, ...spent, unreachable, kept: dir }
    : { passed, replays: replayed, seconds, ...spent, unreachable };
};

const runs = Number(process.argv[2] ?? 2);
const only = new Set(process.argv.slice(3));
const tasks = load().filter((task) => only.size === 0 || only.has(task.name));

console.log(
  `${tasks.length} task(s) × ${runs} run(s), checked by shell, no model judges the result\n`,
);
let passes = 0;
let total = 0;
let replaysAll = true;
let spentIn = 0;
let spentOut = 0;
for (const task of tasks) {
  const results: Attempt[] = [];
  for (let run = 0; run < runs; run += 1) {
    const outcome = await attempt(task);
    results.push(outcome);
    process.stdout.write(outcome.unreachable ? "-" : outcome.passed ? "." : "x");
  }
  // An attempt that never reached the provider measured nothing, so it is not
  // scored either way — counted and named, so the score is never quietly short.
  const scored = results.filter((result) => !result.unreachable);
  const lost = results.length - scored.length;
  const won = scored.filter((result) => result.passed).length;
  const times = results.map((result) => result.seconds);
  const elapsed = times.reduce((sum, seconds) => sum + seconds, 0);
  passes += won;
  total += scored.length;
  // The worst run, not only the mean: one attempt in ten takes minutes, and an
  // average over three hides it inside a plausible-looking number.
  const replayedCount = scored.filter((result) => result.replays).length;
  replaysAll = replaysAll && replayedCount === scored.length;
  const mean = (pick: (attempt: Attempt) => number) =>
    Math.round(results.reduce((sum, result) => sum + pick(result), 0) / results.length);
  spentIn += results.reduce((sum, result) => sum + result.tokensIn, 0);
  spentOut += results.reduce((sum, result) => sum + result.tokensOut, 0);
  console.log(
    ` ${task.name}: ${won}/${scored.length}${lost === 0 ? "" : ` (+${lost} unreachable)`}` +
      ` (${(elapsed / results.length).toFixed(0)}s avg, ${Math.max(...times).toFixed(0)}s worst,` +
      ` ${mean((attempt) => attempt.calls)} calls,` +
      ` ${mean((attempt) => attempt.tokensIn)}/${mean((attempt) => attempt.tokensOut)} tokens in/out` +
      `${replayedCount === scored.length ? "" : `, ${replayedCount}/${scored.length} replay`})`,
  );
  for (const kept of results.filter((result) => result.kept !== undefined)) {
    const why = !kept.passed ? "failed" : !kept.replays ? "did not replay" : "slow";
    console.log(`    ${why} (${kept.seconds.toFixed(0)}s): ${kept.kept}`);
  }
}
console.log(
  `\ntotal: ${passes}/${total}${replaysAll ? ", every log replays" : ""}` +
    `, ${spentIn.toLocaleString("en-US")} tokens in and ${spentOut.toLocaleString("en-US")} out`,
);
process.exit(passes === total && replaysAll ? 0 : 1);
