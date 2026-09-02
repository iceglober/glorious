import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PROVIDER_ALIASES,
  PROVIDERS,
  type ProviderSpec,
} from "../../packages/glrs-providers/src/providers.ts";
import { compareDocumentPaths } from "../plugins/group-documents-utils.ts";

type Schema = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  $ref?: string;
  oneOf?: Schema[];
  properties?: Record<string, Schema | boolean>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  $defs?: Record<string, Schema>;
};

const escape = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const generatedFrom = (source: string): string => `<small>generated from: ${source}</small>`;

const resolveRef = (value: Schema, root: Schema): Schema => {
  if (!value.$ref?.startsWith("#/$defs/")) return value;
  return { ...(root.$defs?.[value.$ref.slice("#/$defs/".length)] ?? {}), ...value, $ref: undefined };
};

const typeLabel = (raw: Schema, root: Schema): string => {
  const value = resolveRef(raw, root);
  if (value.enum) return value.enum.map((entry) => JSON.stringify(entry)).join(" or ");
  if (value.oneOf) return value.oneOf.map((entry) => typeLabel(entry, root)).join(" or ");
  if (value.type === "array") return `${typeLabel(value.items ?? {}, root)}[]`;
  return value.type ?? "value";
};

const rows = (
  properties: Record<string, Schema | boolean>,
  root: Schema,
  prefix = "",
): Array<{ name: string; schema: Schema }> => {
  const output: Array<{ name: string; schema: Schema }> = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (typeof raw === "boolean") continue;
    const fullName = `${prefix}${name}`;
    const value = resolveRef(raw, root);
    output.push({ name: fullName, schema: value });
    const objectVariant = value.oneOf?.map((entry) => resolveRef(entry, root)).find((entry) => entry.properties);
    const nested = value.properties ?? objectVariant?.properties;
    if (nested) output.push(...rows(nested, root, `${fullName}.`));
    const arbitrary =
      typeof value.additionalProperties === "object"
        ? resolveRef(value.additionalProperties, root)
        : undefined;
    if (arbitrary?.properties)
      output.push(...rows(arbitrary.properties, root, `${fullName}.<name>.`));
  }
  return output;
};

export const configReference = (root: Schema & { $id?: string }): string => {
  const lines = [
    "# configuration options",
    "",
    generatedFrom(`<a href="${root.$id}">config schema</a>`),
    "",
    "| setting | type | default | description |",
    "| --- | --- | --- | --- |",
  ];
  for (const { name, schema: value } of rows(root.properties ?? {}, root)) {
    const defaultValue = value.default === undefined ? "" : `\`${JSON.stringify(value.default)}\``;
    lines.push(
      `| \`${escape(name)}\` | \`${escape(typeLabel(value, root))}\` | ${defaultValue} | ${escape(value.description ?? "")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
};

export const providerReference = (
  providers: readonly ProviderSpec[],
  aliases: Readonly<Record<string, string>>,
): string => {
  const lines = [
    "# all providers",
    "",
    generatedFrom("provider registry"),
    "",
    "| provider | prefix | credentials `doctor` recognizes | `doctor` also checks | note |",
    "| --- | --- | --- | --- | --- |",
    ...providers.map(
      (provider) =>
        `| ${escape(provider.label)} | \`${provider.id}\` | ${provider.env.map((name) => `\`${name}\``).join(" or ")} | ${(provider.needs ?? []).map((name) => `\`${name}\``).join(", ")} | ${escape(provider.note ?? "")} |`,
    ),
    "",
    "## accepted shorthands",
    "",
    ...Object.entries(aliases).map(([alias, provider]) => `- \`${alias}\` → \`${provider}\``),
  ];
  return `${lines.join("\n")}\n`;
};


// The homepage carried one line, and TypeDoc's own index links nothing, so the
// four groups were reachable only through the sidebar. This walks the published
// tree and writes the whole outline out, expanded, every level. Generated so a
// page added later appears without anyone remembering to add it.
const GROUP_TITLES: Record<string, string> = {
  "1-tutorials": "tutorials",
  "2-how-to": "how-to guides",
  "3-explanation": "explanation",
  "9-reference": "reference",
};

const titleOf = async (file: string): Promise<string> => {
  const text = await readFile(file, "utf8");
  return /^title:\s*(.+)$/mu.exec(text)?.[1]?.trim() ?? "";
};

const outline = async (published: string): Promise<string> => {
  const groups = (await readdir(published, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareDocumentPaths);

  const lines: string[] = [];
  for (const group of groups) {
    const heading = GROUP_TITLES[group] ?? group;
    lines.push(`## ${heading}`, "");
    const files = (await readdir(join(published, group)))
      .filter((name) => name.endsWith(".md"))
      .sort(compareDocumentPaths);
    for (const file of files) {
      const title = await titleOf(join(published, group, file));
      lines.push(`- [${title}](../docs/published/${group}/${file})`);
    }
    lines.push("");
  }
  return lines.join("\n");
};

const document = (title: string, content: string): string =>
  `---\ntitle: ${title}\n---\n\n${content}`;

export const generateDocuments = async (
  site: string = join(import.meta.dir, ".."),
): Promise<void> => {
  const schema = JSON.parse(await readFile(join(site, "public", "config.schema.json"), "utf8")) as Schema & {
    $id: string;
  };
  const directory = join(site, "generated", "9-reference");
  // Emptied first. Writing without clearing left a previous run's filenames in
  // place beside the new ones, and TypeDoc took both, so the nav showed
  // "all providers" twice with the second disambiguated to "all providers-1".
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  // The homepage outline needs the published tree beside the site. Tests call
  // this against a scratch directory that has only the site half, so a missing
  // tree skips the homepage rather than failing the reference generation.
  const published = join(site, "..", "docs", "published");
  if (existsSync(published))
    await writeFile(
      join(site, "homepage.md"),
      `${await readFile(join(site, "homepage.md.head"), "utf8")}\n${await outline(published)}`,
    );
  await Promise.all([
    writeFile(
      join(directory, "15-configuration-options.md"),
      document("configuration options", configReference(schema)),
    ),
    writeFile(
      join(directory, "16-providers.md"),
      document("all providers", providerReference(PROVIDERS, PROVIDER_ALIASES)),
    ),
  ]);
};

if (import.meta.main) await generateDocuments();
