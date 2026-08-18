import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAzure } from "@ai-sdk/azure";
import { generateText, stepCountIs, type ToolSet, tool } from "ai";
import { z } from "zod";
import { systemPrompt } from "../../packages/glorious-coding-agent/src/prompt";

// The subagent instructions as of adbd6fa, the commit whose numbers the README
// reports. They used to be the coding agent prompt's craftRules export; run_subagent and
// that export were removed *because* of what this eval measured, so the text is
// pinned here rather than imported — an arm that reads today's prompt would not
// be re-running the same experiment.
const craftRules = `<non-negotiables>
  - Conventions: do what the neighboring code does — naming, layout, error
    handling, test shape. Read it before you write.
  - Dependencies: a library exists only if the manifest or an existing import
    says so. Check first, then use it.
  - Scope: touch what the task needs and nothing more.
</non-negotiables>

<grounding>
  A path, symbol, signature, config value, or passing check is real once a tool
  showed it to you this session. Re-read a file right before editing it; re-run
  a check before calling it green.
</grounding>`;

// Does delegating actually pay, or does it only move tokens around?
//
// run.ts stubbed the subagent, so it could only measure whether the agent
// reached for the tool. Here the subagent is real: its own model loop, its own
// file tools, its own context. Both arms answer the same question over the same
// 18-module fixture; only the availability of run_subagent differs.
//
// Reported per run: what the parent's context cost, what the subagents cost on
// top, and whether the answer was right. A win has to survive the total.

const model = createAzure({ apiKey: process.env.AZURE_OPENAI_API_KEY })(
  process.env.GLORIOUS_MODEL ?? "gpt-5.6-luna",
);

const SEEDS = Number(process.env.SEEDS ?? 4);
const here = new URL(".", import.meta.url).pathname;
const TRUTH = ["enqueueAgain", "deferJob", "requeueLater"];

const QUESTION =
  "A job is being put back on the wire more than once. Find every place in this codebase that re-schedules a job after a failure, and name the helper functions. They do not share a name or a comment keyword, so searching for one term will not find them. I only want the list, not a tour of the files.";

const fileTools = (root: string): ToolSet =>
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

const subagentInstructions = `<identity>
  You are a dedicated subagent working for Glorious.
</identity>

${craftRules}

The brief you are given is your complete starting context; do not assume access to the parent conversation. Work only on the task in that brief. You have no way to ask anyone anything and cannot delegate further. Return a concise summary of what you found.`;

// Amp ships a search-specialised subagent (the Librarian). This is that idea:
// read-only tools, and instructions that ask for located facts rather than an
// explanation. The question is whether specialising closes the cost gap that
// the generic subagent loses on.
const librarianInstructions = `<identity>
  You are the Librarian, a search subagent working for Glorious.
</identity>

You locate things in a codebase and report where they are. You do not explain,
summarise the design, or suggest changes.

  - Narrow before you read. Use glob and grep to find candidates, and open only
    the files that survive.
  - Stop as soon as the brief is answered. Reading more is not thoroughness.
  - Report as a list of located facts: path, symbol, and one clause on why it
    matches. No preamble, no conclusion, no restating the brief.

You have read-only tools and cannot change anything, ask anyone anything, or
delegate further.`;

type Run = {
  arm: string;
  found: number;
  parentInput: number;
  subInput: number;
  subCalls: number;
  steps: number;
  endContext: number;
  wall: number;
};

const runOne = async (arm: string): Promise<Run> => {
  const root = await mkdtemp(join(tmpdir(), `pays-${arm}-`));
  await cp(join(here, "fixture"), root, { recursive: true });
  let subInput = 0;
  let subCalls = 0;
  const started = Date.now();

  const delegate = tool({
    description:
      "Launch a dedicated coding agent for one focused task. Before calling it, provide a standalone brief with the goal, relevant files, constraints, and what a finished answer looks like. It starts without the parent conversation.",
    inputSchema: z.object({ task: z.string().min(1), context: z.string().min(1) }),
    execute: async ({ task, context }) => {
      subCalls += 1;
      const sub = await generateText({
        model,
        instructions: arm === "librarian" ? librarianInstructions : subagentInstructions,
        tools: fileTools(root),
        stopWhen: [stepCountIs(20)],
        maxOutputTokens: 3000,
        maxRetries: 3,
        providerOptions: { openai: { reasoningEffort: "medium", textVerbosity: "low" } },
        messages: [
          {
            role: "user",
            content: `<task>\n${task}\n</task>\n\n<context>\n${context}\n</context>`,
          },
        ],
      });
      subInput += sub.usage.inputTokens ?? 0;
      return sub.text || "(the subagent reported nothing)";
    },
  });

  const result = await generateText({
    model,
    instructions: systemPrompt({ rules: "" }),
    tools:
      arm === "solo"
        ? fileTools(root)
        : ({ ...fileTools(root), run_subagent: delegate } as ToolSet),
    stopWhen: [stepCountIs(16)],
    maxOutputTokens: 3000,
    maxRetries: 3,
    providerOptions: { openai: { reasoningEffort: "medium", textVerbosity: "low" } },
    messages: [{ role: "user", content: QUESTION }],
  });

  await rm(root, { recursive: true, force: true });
  const answer = result.text.toLowerCase();
  return {
    arm,
    found: TRUTH.filter((n) => answer.includes(n.toLowerCase())).length,
    parentInput: result.usage.inputTokens ?? 0,
    subInput,
    subCalls,
    steps: result.steps.length,
    endContext: result.steps.at(-1)?.usage.inputTokens ?? 0,
    wall: Date.now() - started,
  };
};

const rows: Run[] = [];
for (let seed = 0; seed < SEEDS; seed += 1)
  for (const arm of ["solo", "delegate", "librarian"]) {
    const row = await runOne(arm);
    rows.push(row);
    console.log(
      `  ${arm.padEnd(9)} seed${seed}  found ${row.found}/3  billed ${row.parentInput}  ENDING CONTEXT ${row.endContext}  sub ${row.subInput}  ${Math.round(row.wall / 100) / 10}s`,
    );
  }

console.log("\n== summary ==");
for (const arm of ["solo", "delegate", "librarian"]) {
  const g = rows.filter((r) => r.arm === arm);
  const avg = (p: (r: Run) => number) => g.reduce((s, r) => s + p(r), 0) / g.length;
  console.log(
    `  ${arm.padEnd(9)} ending context ${Math.round(avg((r) => r.endContext))}  billed ${Math.round(avg((r) => r.parentInput))}  total billed ${Math.round(avg((r) => r.parentInput + r.subInput))}`,
  );
}
await Bun.write(join(here, "pays-results.json"), JSON.stringify(rows, null, 2));
