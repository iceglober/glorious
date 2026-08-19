import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAzure } from "@ai-sdk/azure";
import { generateText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { createEditTool, type Variant } from "./variants";

const FIXTURES = ["one-file", "spread"] as const;
const VARIANTS: Variant[] = ["batch", "multi"];
const SEEDS = Number(process.env.SEEDS ?? 3);
const STEP_LIMIT = 30;

const model = createAzure({ apiKey: process.env.AZURE_OPENAI_API_KEY })(
  process.env.GLRS_MODEL ?? "gpt-5.6-luna",
);

const here = new URL(".", import.meta.url).pathname;

const readTool = (root: string) =>
  ({
    read: {
      description:
        "Read a UTF-8 text file. Each output line is prefixed with `N|`, its 1-based line number. That prefix is display-only — never write it back.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        const text = await Bun.file(join(root, path))
          .text()
          .catch(() => null);
        if (text === null) return `ERROR: cannot read ${path}`;
        return text
          .split("\n")
          .map((row, n) => `${n + 1}|${row}`)
          .join("\n");
      },
    },
  }) as unknown as ToolSet;

const run = async (fixture: string, variant: Variant) => {
  const root = await mkdtemp(join(tmpdir(), `edit-eval-${fixture}-${variant}-`));
  await cp(join(here, "fixtures", fixture), root, { recursive: true });
  let editCalls = 0;
  const started = Date.now();
  let usage = { input: 0, output: 0 };
  let steps = 0;
  try {
    const result = await generateText({
      model,
      instructions:
        "You are fixing bugs in a small Python package. Read the files you need, then repair every bug so that `python3 check.py` passes. Change only what is wrong. Do not run any commands — you have only read and edit. When you are done, say DONE.",
      tools: {
        ...readTool(root),
        edit: createEditTool(root, variant, () => {
          editCalls += 1;
        }),
      },
      stopWhen: [stepCountIs(STEP_LIMIT)],
      maxRetries: 3,
      providerOptions: { openai: { reasoningEffort: "medium", textVerbosity: "low" } },
      messages: [
        {
          role: "user",
          content: `The package in this directory has ${fixture === "spread" ? "four" : "four"} bugs. check.py lists what each function must return. Read the source files and fix every bug.`,
        },
      ],
    });
    steps = result.steps.length;
    usage = { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 };
  } catch (thrown) {
    return {
      fixture,
      variant,
      pass: false,
      note: thrown instanceof Error ? thrown.message.slice(0, 60) : "failed",
      editCalls,
      steps,
      ...usage,
      wall: Date.now() - started,
    };
  }
  const wall = Date.now() - started;
  const graded = Bun.spawnSync(["python3", "check.py"], { cwd: root });
  await rm(root, { recursive: true, force: true });
  return {
    fixture,
    variant,
    pass: graded.exitCode === 0,
    note: "",
    editCalls,
    steps,
    ...usage,
    wall,
  };
};

const rows: Awaited<ReturnType<typeof run>>[] = [];
for (let seed = 0; seed < SEEDS; seed += 1)
  for (const fixture of FIXTURES)
    for (const variant of VARIANTS) {
      const row = await run(fixture, variant);
      rows.push(row);
      console.log(
        `  ${fixture.padEnd(9)} ${variant.padEnd(6)} seed${seed}  ${row.pass ? "PASS" : "FAIL"}  edits=${row.editCalls} steps=${row.steps} in=${row.input} out=${row.output} ${Math.round(row.wall / 100) / 10}s ${row.note}`,
      );
    }

console.log("\n== averages ==");
for (const fixture of FIXTURES)
  for (const variant of VARIANTS) {
    const got = rows.filter((r) => r.fixture === fixture && r.variant === variant);
    const avg = (pick: (r: (typeof got)[number]) => number) =>
      got.reduce((sum, r) => sum + pick(r), 0) / got.length;
    console.log(
      `  ${fixture.padEnd(9)} ${variant.padEnd(6)} pass ${got.filter((r) => r.pass).length}/${got.length}  editCalls ${avg((r) => r.editCalls).toFixed(1)}  steps ${avg((r) => r.steps).toFixed(1)}  in ${Math.round(avg((r) => r.input))}  out ${Math.round(avg((r) => r.output))}  wall ${(avg((r) => r.wall) / 1000).toFixed(1)}s`,
    );
  }
await Bun.write(join(here, "results.json"), JSON.stringify(rows, null, 2));
