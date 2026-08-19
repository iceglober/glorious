import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAzure } from "@ai-sdk/azure";
import { generateText, type ModelMessage, stepCountIs, type ToolSet, tool } from "ai";
import { z } from "zod";
import { systemPrompt } from "../../packages/glrs-coding-agent/src/prompt";

// Does a long context make this model worse at the same job?
//
// Everything in eval/delegation rests on "longer is worse", which has been
// assumed and never measured. Here the task, tools and fixture are fixed and
// only the amount of prior conversation changes: plausible earlier turns about
// other parts of the same codebase, carrying nothing the task needs.
//
// The padding is built as nested prefixes — the 200k transcript begins with the
// 100k one — so the provider's cache is reused across sizes and seeds, and the
// run costs a fraction of its nominal token count.

const model = createAzure({ apiKey: process.env.AZURE_OPENAI_API_KEY })(
  process.env.GLRS_MODEL ?? "gpt-5.6-luna",
);

const SIZES = (process.env.SIZES ?? "4000,25000,60000,120000,200000").split(",").map(Number);
const SEEDS = Number(process.env.SEEDS ?? 3);
const here = new URL(".", import.meta.url).pathname;
const TRUTH = ["enqueueAgain", "deferJob", "requeueLater"];

const QUESTION =
  "A job is being put back on the wire more than once. Find every place in this codebase that re-schedules a job after a failure, and name the helper functions. They do not share a name or a comment keyword, so searching for one term will not find them. Answer with the list only — no tour of the files, no explanation.";

// plausible earlier work on the same codebase, none of it touching the answer
const chatter = (n: number): ModelMessage[] => [
  {
    role: "user",
    content: `Earlier task ${n}: walk me through what ${["telemetry", "codec", "router", "store", "limiter", "hooks", "config", "errors"][n % 8]}.ts contributes to the pipeline.`,
  },
  {
    role: "assistant",
    content: `Module ${n} exposes nine handlers, each stamping a stage tag onto the job trail and re-emitting it. ${"They validate the job id, append their tag, and return a shallow copy so the caller keeps the original. Nothing in here schedules work or touches timers; the handlers are pure transformations over the job record and are safe to reorder. ".repeat(9)}`,
  },
];

const padTo = (budget: number): ModelMessage[] => {
  const out: ModelMessage[] = [];
  let size = 0;
  for (let n = 0; size < budget; n += 1) {
    const pair = chatter(n);
    out.push(...pair);
    size += pair.reduce((s, m) => s + String(m.content).length / 4, 0);
  }
  return out;
};

const tools = (root: string): ToolSet =>
  ({
    read: tool({
      description: "Read a UTF-8 text file. Lines are prefixed `N|`.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const text = await Bun.file(join(root, path))
          .text()
          .catch(() => null);
        return text === null
          ? `ERROR: cannot read ${path}`
          : text
              .split("\n")
              .map((r, n) => `${n + 1}|${r}`)
              .join("\n");
      },
    }),
    glob: tool({
      description: "List files matching a glob, relative to the project root.",
      inputSchema: z.object({ pattern: z.string() }),
      execute: async () => [...new Bun.Glob("**/*.ts").scanSync({ cwd: root })].sort().join("\n"),
    }),
    grep: tool({
      description: "Search file contents with a regular expression.",
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) => {
        const hits: string[] = [];
        for (const file of [...new Bun.Glob("**/*.ts").scanSync({ cwd: root })].sort()) {
          const text = await Bun.file(join(root, file)).text();
          text.split("\n").forEach((line, n) => {
            if (new RegExp(pattern).test(line)) hits.push(`${file}:${n + 1}:${line.trim()}`);
          });
        }
        return hits.length === 0 ? "No matches." : hits.join("\n");
      },
    }),
  }) as ToolSet;

type Row = {
  size: number;
  found: number;
  startContext: number;
  steps: number;
  answerChars: number;
  terse: boolean;
  wall: number;
  failed: string;
};

const once = async (budget: number): Promise<Row> => {
  const root = await mkdtemp(join(tmpdir(), "ctx-"));
  await cp(join(here, "..", "delegation", "fixture"), root, { recursive: true });
  const started = Date.now();
  try {
    const result = await generateText({
      model,
      instructions: systemPrompt({ rules: "" }),
      tools: tools(root),
      stopWhen: [stepCountIs(16)],
      maxOutputTokens: 3000,
      maxRetries: 2,
      providerOptions: {
        openai: { reasoningEffort: "medium", textVerbosity: "low", promptCacheKey: "ctx-curve" },
      },
      messages: [...padTo(budget), { role: "user", content: QUESTION }],
    });
    const answer = result.text.toLowerCase();
    return {
      size: budget,
      found: TRUTH.filter((n) => answer.includes(n.toLowerCase())).length,
      startContext: result.steps[0]?.usage.inputTokens ?? 0,
      steps: result.steps.length,
      answerChars: result.text.length,
      // the task says list only; a tour shows up as length
      terse: result.text.length < 700,
      wall: Date.now() - started,
      failed: "",
    };
  } catch (thrown) {
    return {
      size: budget,
      found: 0,
      startContext: 0,
      steps: 0,
      answerChars: 0,
      terse: false,
      wall: Date.now() - started,
      failed: thrown instanceof Error ? thrown.message.slice(0, 70) : "failed",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const rows: Row[] = [];
for (const size of SIZES)
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const row = await once(size);
    rows.push(row);
    console.log(
      row.failed
        ? `  pad ${String(size).padStart(6)} seed${seed}  FAILED ${row.failed}`
        : `  pad ${String(size).padStart(6)} seed${seed}  found ${row.found}/3  ctx ${String(row.startContext).padStart(6)}  steps ${row.steps}  answer ${String(row.answerChars).padStart(4)}ch  ${Math.round(row.wall / 100) / 10}s`,
    );
  }

console.log("\n== curve ==");
for (const size of SIZES) {
  const g = rows.filter((r) => r.size === size && !r.failed);
  if (g.length === 0) {
    console.log(`  pad ${String(size).padStart(6)}  all runs failed`);
    continue;
  }
  const avg = (p: (r: Row) => number) => g.reduce((s, r) => s + p(r), 0) / g.length;
  console.log(
    `  pad ${String(size).padStart(6)}  ctx ${String(Math.round(avg((r) => r.startContext))).padStart(6)}  correct ${g.filter((r) => r.found === 3).length}/${g.length}  avg found ${avg((r) => r.found).toFixed(1)}/3  terse ${g.filter((r) => r.terse).length}/${g.length}  steps ${avg((r) => r.steps).toFixed(1)}  wall ${(avg((r) => r.wall) / 1000).toFixed(1)}s`,
  );
}
await Bun.write(join(here, "results.json"), JSON.stringify(rows, null, 2));
