import { describe, expect, test } from "bun:test";
import { fetchModelCatalog } from "./catalog";

const catalog = {
  openai: {
    models: {
      "gpt-4o": { modalities: { output: ["text"] } }, // reasoning omitted → false
      "gpt-image-1": { modalities: { output: ["image"] } },
      o3: { reasoning: true }, // no modalities → treated as text
    },
  },
  "google-vertex": { models: { "gemini-2.0-flash": { modalities: { output: ["text"] } } } },
  cohere: { models: {} },
};

const fakeFetch = (ok = true): typeof fetch =>
  (async () =>
    ({
      ok,
      status: ok ? 200 : 503,
      json: async () => catalog,
    }) as unknown as Response) as unknown as typeof fetch;

describe("fetchModelCatalog", () => {
  test("maps providers, keeps text models, carries the reasoning flag", async () => {
    const models = await fetchModelCatalog(fakeFetch());
    // image-only dropped; text/unspecified kept; sorted; reasoning flag carried.
    expect(models.openai).toEqual([
      { id: "gpt-4o", reasoning: false },
      { id: "o3", reasoning: true },
    ]);
    // our `vertex` reads models.dev `google-vertex`.
    expect(models.vertex).toEqual([{ id: "gemini-2.0-flash", reasoning: false }]);
    // present-but-empty, missing, and openai-compatible → [].
    expect(models.cohere).toEqual([]);
    expect(models.anthropic).toEqual([]);
    expect(models["openai-compatible"]).toEqual([]);
  });

  test("throws on a non-ok response so the caller can fall back", async () => {
    await expect(fetchModelCatalog(fakeFetch(false))).rejects.toThrow(/models\.dev/);
  });
});
