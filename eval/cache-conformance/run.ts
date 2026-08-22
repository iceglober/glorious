import { randomUUID } from "node:crypto";
import { generateText, type ModelMessage } from "ai";
import { requestSettings } from "../../packages/glrs-coding-agent/src/agent";
import {
  configuredModel,
  createModel,
  hydrateModelCredentials,
  type ModelOption,
  withCacheBreakpoints,
} from "../../packages/provider-registry/src";

type Probe = {
  name: string;
  model: ModelOption;
};

type Reading = {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  durationMs: number;
};

if (process.env.GLRS_RUN_LIVE_CACHE_EVAL !== "1")
  throw new Error("Set GLRS_RUN_LIVE_CACHE_EVAL=1 to run credentialed cache probes.");

const selected = async (
  provider: string,
  modelId: string | undefined,
  modelType?: "responses" | "chat" | "deepseek",
): Promise<ModelOption | undefined> => {
  if (!modelId) return undefined;
  return hydrateModelCredentials({
    ...configuredModel(`${provider}/${modelId}`, {
      providers: {
        "google-vertex": {
          project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
          location: process.env.GOOGLE_CLOUD_LOCATION ?? process.env.GOOGLE_VERTEX_LOCATION,
        },
      },
    }),
    modelType,
  });
};

const probes = (
  await Promise.all([
    selected("azure", process.env.GLRS_CACHE_EVAL_AZURE_RESPONSES_MODEL, "responses").then(
      (model) => model && { name: "azure-responses", model },
    ),
    selected("azure", process.env.GLRS_CACHE_EVAL_AZURE_CHAT_MODEL, "chat").then(
      (model) => model && { name: "azure-chat", model },
    ),
    selected("azure", process.env.GLRS_CACHE_EVAL_AZURE_DEEPSEEK_MODEL, "deepseek").then(
      (model) => model && { name: "azure-deepseek", model },
    ),
    selected("anthropic", process.env.GLRS_CACHE_EVAL_ANTHROPIC_MODEL).then(
      (model) => model && { name: "anthropic", model },
    ),
    selected("google-vertex", process.env.GLRS_CACHE_EVAL_VERTEX_GEMINI_MODEL).then(
      (model) => model && { name: "vertex-gemini", model },
    ),
    selected("google-vertex", process.env.GLRS_CACHE_EVAL_VERTEX_CLAUDE_MODEL).then(
      (model) => model && { name: "vertex-claude", model },
    ),
  ])
).filter((probe): probe is Probe => Boolean(probe));

if (probes.length === 0) throw new Error("Set at least one GLRS_CACHE_EVAL_*_MODEL variable.");

const prefix = `Cache conformance fixture ${randomUUID()}. ${"Stable context. ".repeat(3_000)}`;
const messages: ModelMessage[] = [
  { role: "user", content: prefix },
  { role: "assistant", content: "Acknowledged." },
  { role: "user", content: "Reply with OK." },
];

const call = async (probe: Probe, cacheKey: string): Promise<Reading> => {
  const started = performance.now();
  const result = await generateText({
    model: createModel(probe.model),
    messages: withCacheBreakpoints(
      messages,
      probe.model.provider,
      probe.model.modelId,
      probe.model.modelType,
    ),
    maxOutputTokens: 16,
    maxRetries: 1,
    ...requestSettings(probe.model, cacheKey),
  });
  return {
    input: result.usage.inputTokens,
    cacheRead: result.usage.inputTokenDetails?.cacheReadTokens,
    cacheWrite: result.usage.inputTokenDetails?.cacheWriteTokens,
    durationMs: Math.round(performance.now() - started),
  };
};

const results: Record<string, { cold: Reading; warm: Reading; verified: boolean }> = {};
for (const probe of probes) {
  const cacheKey = `glrs-cache-eval-${randomUUID()}`;
  const cold = await call(probe, cacheKey);
  await Bun.sleep(2_000);
  const warm = await call(probe, cacheKey);
  results[probe.name] = { cold, warm, verified: (warm.cacheRead ?? 0) > 0 };
  console.log(
    `${probe.name}: cold=${cold.cacheRead ?? "unreported"} warm=${warm.cacheRead ?? "unreported"} ` +
      `input=${warm.input ?? "unreported"} duration=${warm.durationMs}ms`,
  );
}

await Bun.write(
  new URL("results.json", import.meta.url).pathname,
  `${JSON.stringify(results, null, 2)}\n`,
);
if (Object.values(results).some((result) => !result.verified)) process.exitCode = 1;
