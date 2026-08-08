import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAzure } from "@ai-sdk/azure";
import { generateText, stepCountIs, type ToolSet, tool } from "ai";
import { z } from "zod";

// Does the prompt get the agent to delegate when delegating is the right call?
//
// The task is a survey across many files whose contents are worthless once the
// answer is known — the case the delegation block calls out and the case the old
// worked examples demonstrated doing by hand. Both arms get the same tools and
// the same task; only the system prompt differs.
//
//   before — the prompt as of a75369e: two long worked examples, neither
//            delegating, and a <grounding> clause that makes a delegated
//            finding inadmissible.
//   after  — four short scenarios, three of which delegate, and a <grounding>
//            clause that admits what a subagent reports.

const model = createAzure({ apiKey: process.env.AZURE_OPENAI_API_KEY })(
  process.env.GLORIOUS_MODEL ?? "gpt-5.6-luna",
);

const SEEDS = Number(process.env.SEEDS ?? 4);
const here = new URL(".", import.meta.url).pathname;

type Run = { arm: string; delegated: number; parallel: boolean; steps: number; input: number };

const tools = (root: string, count: { subagent: number; batches: number[] }): ToolSet =>
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
      execute: async () => {
        const found = new Bun.Glob("**/*.ts").scanSync({ cwd: root });
        return [...found].sort().join("\n");
      },
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
    run_subagent: tool({
      description:
        "Launch a dedicated coding agent for one focused task. Before calling it, provide a standalone brief with the goal, current findings, relevant files and symbols, constraints, non-goals, acceptance criteria, and checks to run. It starts without the parent conversation. Do not use it for decisions that need the user.",
      inputSchema: z.object({
        task: z.string().min(1),
        context: z.string().min(1),
      }),
      // Stubbed: the question is whether the agent reaches for it, not what a
      // real subagent would find. A plausible summary keeps the turn moving.
      execute: async () => {
        count.subagent += 1;
        return "Read every file in the assigned range. Only one re-schedules a job after failure: it does so through a local helper, called from an on*Failure export at the bottom of the file.";
      },
    }),
  }) as ToolSet;

const run = async (arm: string, instructions: string): Promise<Run> => {
  const root = await mkdtemp(join(tmpdir(), `delegation-${arm}-`));
  await cp(join(here, "fixture"), root, { recursive: true });
  const count = { subagent: 0, batches: [] as number[] };
  const result = await generateText({
    model,
    instructions,
    tools: tools(root, count),
    stopWhen: [stepCountIs(14)],
    maxOutputTokens: 3000,
    maxRetries: 3,
    providerOptions: { openai: { reasoningEffort: "medium", textVerbosity: "low" } },
    messages: [
      {
        role: "user",
        content:
          "A job is being put back on the wire more than once. Find every place in this codebase that re-schedules a job after a failure, and name the functions. They do not share a name or a comment keyword, so searching for one term will not find them. I only want the list, not a tour of the files.",
      },
    ],
  });
  // a step issuing more than one run_subagent call is parallel delegation
  for (const step of result.steps)
    count.batches.push(step.toolCalls.filter((c) => c.toolName === "run_subagent").length);
  await rm(root, { recursive: true, force: true });
  return {
    arm,
    delegated: count.subagent,
    parallel: count.batches.some((n) => n > 1),
    steps: result.steps.length,
    input: result.usage.inputTokens ?? 0,
  };
};

const before = await Bun.file(join(here, "before.txt")).text();
const { systemPrompt } = await import("../../v2/prompt");
const after = systemPrompt({ rules: "" });

const rows: Run[] = [];
for (let seed = 0; seed < SEEDS; seed += 1)
  for (const [arm, prompt] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const row = await run(arm, prompt);
    rows.push(row);
    console.log(
      `  ${arm.padEnd(7)} seed${seed}  delegated=${row.delegated} parallel=${row.parallel} steps=${row.steps} in=${row.input}`,
    );
  }

console.log("\n== summary ==");
for (const arm of ["before", "after"]) {
  const g = rows.filter((r) => r.arm === arm);
  const avg = (p: (r: Run) => number) => g.reduce((s, r) => s + p(r), 0) / g.length;
  console.log(
    `  ${arm.padEnd(7)} delegated in ${g.filter((r) => r.delegated > 0).length}/${g.length} runs  avg calls ${avg((r) => r.delegated).toFixed(1)}  parallel in ${g.filter((r) => r.parallel).length}  avg steps ${avg((r) => r.steps).toFixed(1)}  avg input ${Math.round(avg((r) => r.input))}`,
  );
}
await Bun.write(join(here, "results.json"), JSON.stringify(rows, null, 2));
