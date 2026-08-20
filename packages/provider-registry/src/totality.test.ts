import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { createModel, currentModel, PROVIDER_SETTINGS, settingsFor } from "./models";

// The config used to accept a key, validate it, merge it across files, and then
// drop it before the model was built — `providers.azure.api` on the default
// provider, `api` on bedrock and vertex, `variant` on anything but OpenAI.
// Each was indistinguishable from a setting that worked.
//
// These walk the declared table rather than checking known cases, so a provider
// added later is covered by construction: whatever `settingsFor` says a
// provider reads, this proves it survives the trip into the model options.

const project = async (config: unknown): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glrs-total-"));
  await mkdir(join(root, ".glrs"), { recursive: true });
  await writeFile(join(root, ".glrs", "config.json"), JSON.stringify(config));
  return root;
};

const VALUES: Record<string, string> = {
  api: "https://endpoint.example/v1",
  region: "eu-west-2",
  project: "some-project",
  location: "europe-west4",
};

describe("every setting a provider reads reaches the model option", () => {
  const providers = [...Object.keys(PROVIDER_SETTINGS), "azure", "anthropic", "ollama"];

  for (const provider of providers)
    test(`${provider} carries ${settingsFor(provider).join(", ")}`, async () => {
      const reads = settingsFor(provider);
      const block = Object.fromEntries(reads.map((key) => [key, VALUES[key]]));
      const root = await project({
        model: `${provider}/some-model`,
        providers: { [provider]: block },
      });
      const { config } = await loadConfig(root);
      const option = currentModel(config) as Record<string, unknown>;
      for (const key of reads) expect(option[key]).toBe(VALUES[key]);
      await rm(root, { recursive: true, force: true });
    });
});

describe("a setting a provider does not read says so", () => {
  test("it is reported rather than silently dropped", async () => {
    const root = await project({
      model: "anthropic/claude",
      providers: { anthropic: { region: "us-east-1" } },
    });
    const { diagnostics } = await loadConfig(root);
    expect(diagnostics.join(" ")).toContain("providers.anthropic.region is not used");
    await rm(root, { recursive: true, force: true });
  });

  test("a setting it does read is not complained about", async () => {
    const root = await project({
      model: "anthropic/claude",
      providers: { anthropic: { api: "https://x/v1" } },
    });
    const { diagnostics } = await loadConfig(root);
    expect(diagnostics.join(" ")).not.toContain("is not used");
    await rm(root, { recursive: true, force: true });
  });
});

describe("the base URL reaches the client for every provider that takes one", () => {
  // azure is the case that mattered: the former default provider, and the one
  // branch of createModel that dropped baseURL entirely.
  for (const provider of ["azure", "anthropic", "amazon-bedrock", "google-vertex", "ollama"])
    test(`${provider} is constructed without throwing when given a base URL`, async () => {
      const root = await project({
        model: `${provider}/some-model`,
        providers: { [provider]: { api: VALUES.api } },
      });
      const { config } = await loadConfig(root);
      expect(currentModel(config).api).toBe(VALUES.api);
      expect(() => createModel(currentModel(config))).not.toThrow();
      await rm(root, { recursive: true, force: true });
    });
});
