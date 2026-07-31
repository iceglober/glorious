/**
 * Re-derive a recorded branch and say whether it still holds.
 *
 * This exists because unit tests were green while gated runs on disk could not
 * replay at all: the tests built their runtimes with default settings, so they
 * never exercised the configuration the runner actually used. Replaying a real
 * log is the check that catches that class of bug, and it is worth a command
 * rather than a script written from memory each time.
 *
 * It calls no provider. Every completion is served from the recording, so this
 * is offline, free, and safe to run over an old log.
 *
 *   bun activegraph/examples/verify-log.ts [path/to/coding-agent.db] [branch]
 *
 * Exits non-zero on divergence, so it can gate anything that cares.
 */

import { createSqliteEventStore } from "../adapters/sqlite-event-store";
import { unwrap } from "../lib/fp";
import { replayStrict } from "../shell/replay";
import {
  type CodingAgentSchema,
  codingAgentSchema,
  createCodingAgentBehaviors,
} from "./coding-agent";
import { type Divergence, describeDivergence } from "./divergence";
import { formatRunSummary, summarizeRun } from "./run-summary";

const path = process.argv[2] ?? "coding-agent.db";
const branch = process.argv[3] ?? "main";

const store = createSqliteEventStore<CodingAgentSchema>(path);
const log = unwrap(await store.read({ branch }));

if (log.length === 0) {
  console.error(`${path}: branch "${branch}" is empty`);
  store.close();
  process.exit(1);
}

const goals = log.filter((event) => (event.type as string) === "goal.created").length;
console.log(`${path} — branch "${branch}", ${log.length} events, ${goals} goal(s)`);
console.log(`  ${formatRunSummary(summarizeRun(log))}`);

// No arguments: whether the branch re-derives from itself is the whole point.
const verdict = await replayStrict({
  schema: codingAgentSchema,
  behaviors: createCodingAgentBehaviors(),
  store,
  branch,
});
store.close();

if (verdict.ok) {
  console.log("\nreplay: ok — the branch re-derives from itself, no provider reached");
  process.exit(0);
}

console.error("\nreplay: DIVERGED");
if (verdict.error.reason === "diverged") {
  for (const line of describeDivergence(verdict.error.divergence as Divergence)) {
    console.error(`  ${line}`);
  }
} else {
  console.error(`  ${JSON.stringify(verdict.error)}`);
}
process.exit(1);
