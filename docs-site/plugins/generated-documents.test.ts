import { describe, expect, test } from "bun:test";
import { PROVIDER_ALIASES, PROVIDERS } from "../../packages/provider-registry/src/providers";
import schema from "../public/config.schema.json";
import { configReference, providerReference } from "./generated-documents";

describe("generated documentation", () => {
  test("configuration reference comes from the hosted schema", () => {
    const markdown = configReference(schema);
    expect(markdown).toContain(
      '<small>generated from: <a href="https://glrs.dev/config.schema.json">config schema</a></small>',
    );
    expect(markdown).toContain("`model`");
    expect(markdown).toContain("`extensions.load`");
    expect(markdown).toContain("`providers.<name>.location`");
    expect(markdown).toContain('"one-at-a-time" or "all"');
  });

  test("provider reference comes from the runtime registry", () => {
    const markdown = providerReference(PROVIDERS, PROVIDER_ALIASES);
    expect(markdown).toContain("<small>generated from: provider registry</small>");
    for (const provider of PROVIDERS) expect(markdown).toContain(`\`${provider.id}\``);
    for (const alias of Object.keys(PROVIDER_ALIASES)) expect(markdown).toContain(`\`${alias}\``);
  });
});
