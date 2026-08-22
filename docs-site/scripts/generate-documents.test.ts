import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDER_ALIASES, PROVIDERS } from "../../packages/provider-registry/src/providers";
import schema from "../public/config.schema.json";
import { configReference, generateDocuments, providerReference } from "./generate-documents";

describe("generated documentation", () => {
  test("configuration reference comes from the hosted schema", () => {
    const markdown = configReference(schema);
    expect(markdown).toContain("# configuration options");
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
    expect(markdown).toContain("# all providers");
    expect(markdown).toContain("<small>generated from: provider registry</small>");
    for (const provider of PROVIDERS) expect(markdown).toContain(`\`${provider.id}\``);
    for (const alias of Object.keys(PROVIDER_ALIASES)) expect(markdown).toContain(`\`${alias}\``);
  });

  test("writes ordinary markdown documents for TypeDoc", async () => {
    const site = await mkdtemp(join(tmpdir(), "glrs-generated-docs-"));
    await mkdir(join(site, "public"), { recursive: true });
    await writeFile(join(site, "public", "config.schema.json"), JSON.stringify(schema));
    await generateDocuments(site);
    expect(await readFile(join(site, "generated", "9-reference", "15-configuration-options.md"), "utf8"))
      .toContain("title: configuration options");
    expect(await readFile(join(site, "generated", "9-reference", "16-providers.md"), "utf8"))
      .toContain("title: all providers");
    await rm(site, { recursive: true, force: true });
  });

  test("orders the homepage outline by number, not by string", async () => {
    // A directory of ten or more pages is the only place this shows: plain
    // localeCompare puts 10-rules straight after 1-cli, ahead of 2-tui.
    const root = await mkdtemp(join(tmpdir(), "glrs-outline-"));
    const site = join(root, "site");
    const reference = join(root, "docs", "published", "9-reference");
    await mkdir(join(site, "public"), { recursive: true });
    await mkdir(reference, { recursive: true });
    await writeFile(join(site, "public", "config.schema.json"), JSON.stringify(schema));
    await writeFile(join(site, "homepage.md.head"), "lead\n");
    for (const [file, title] of [
      ["1-cli.md", "cli"],
      ["2-tui.md", "the tui"],
      ["10-rules.md", "rules"],
      ["11-extensions.md", "extensions"],
    ])
      await writeFile(join(reference, file), `---\ntitle: ${title}\n---\n`);

    await generateDocuments(site);
    const homepage = await readFile(join(site, "homepage.md"), "utf8");
    const order = [...homepage.matchAll(/^- \[([^\]]+)\]/gmu)].map((match) => match[1]);
    expect(order).toEqual(["cli", "the tui", "rules", "extensions"]);
    await rm(root, { recursive: true, force: true });
  });
});
