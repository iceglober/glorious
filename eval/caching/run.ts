import { createHash } from "node:crypto";
import { createAzure } from "@ai-sdk/azure";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { environmentPrompt, systemPrompt } from "../../packages/glrs-coding-agent/src/prompt";

// Does putting volatile content in the system prompt cost the cache?
//
// Shape A is what glrs used to do: the environment block sat at the tail of
// the system prompt. Shape B is what it does now: the system prompt is static
// and the environment rides inside the user message, frozen into history.
//
// Both run the same two turns. Between them the environment changes, which is
// what happens whenever a session is resumed — the date moves, the branch moves,
// the dirty-file count moves. Turn 2 reports how much of its input was served
// from cache.

const model = createAzure({ apiKey: process.env.AZURE_OPENAI_API_KEY })(
  process.env.GLRS_MODEL ?? "gpt-5.6-luna",
);

const rules = "# Conventions\n- Use bun, never npm.\n- Function components only.\n";
const filler = "Background the assistant should remember. ".repeat(120);

const env1 = environmentPrompt({
  cwd: "/repo",
  os: "Darwin 25.2.0",
  date: "2026-08-07",
  git: "main clean",
});
const env2 = environmentPrompt({
  cwd: "/repo",
  os: "Darwin 25.2.0",
  date: "2026-08-08",
  git: "main 7 files changed",
});

const ask = async (instructions: string, messages: ModelMessage[], key: string) => {
  const result = await generateText({
    model,
    instructions,
    stopWhen: [stepCountIs(1)],
    maxOutputTokens: 500,
    maxRetries: 3,
    providerOptions: {
      openai: { reasoningEffort: "medium", textVerbosity: "low", promptCacheKey: key },
    },
    messages,
  });
  const input = result.usage.inputTokens ?? 0;
  const cached = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
  return { input, cached, share: input === 0 ? 0 : Math.round((cached / input) * 100) };
};

const key = (name: string) => createHash("sha256").update(name).digest("hex").slice(0, 32);
const question = `${filler}\nReply with the single word ONE.`;

const shapeA = async () => {
  // environment in the system prompt, history without it
  const history: ModelMessage[] = [
    { role: "user", content: question },
    { role: "assistant", content: "ONE" },
  ];
  const k = key("volatile-in-system-prompt");
  const first = await ask(`${systemPrompt({ rules })}\n\n${env1}`, history, k);
  const second = await ask(
    `${systemPrompt({ rules })}\n\n${env2}`,
    [...history, { role: "user", content: "Reply with the single word TWO." }],
    k,
  );
  return { first, second };
};

const shapeB = async () => {
  // static system prompt, environment inside each user message
  const history: ModelMessage[] = [
    { role: "user", content: `${env1}\n\n${question}` },
    { role: "assistant", content: "ONE" },
  ];
  const k = key("volatile-in-user-message");
  const instructions = systemPrompt({ rules });
  const first = await ask(instructions, history, k);
  const second = await ask(
    instructions,
    [...history, { role: "user", content: `${env2}\n\nReply with the single word TWO.` }],
    k,
  );
  return { first, second };
};

const a = await shapeA();
const b = await shapeB();

const line = (name: string, r: Awaited<ReturnType<typeof shapeA>>) =>
  `  ${name.padEnd(34)} turn1 ${String(r.first.share).padStart(3)}%   turn2 ${String(r.second.share).padStart(3)}%  (${r.second.cached}/${r.second.input})`;

console.log("\ncache read share of input tokens\n");
console.log(line("environment in system prompt", a));
console.log(line("environment in user message", b));

await Bun.write(
  new URL("results.json", import.meta.url).pathname,
  JSON.stringify({ volatileInSystemPrompt: a, volatileInUserMessage: b }, null, 2),
);
