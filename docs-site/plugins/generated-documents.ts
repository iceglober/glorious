import { readFileSync } from "node:fs";
import { Application, Converter, type DocumentReflection } from "typedoc";
import {
  PROVIDER_ALIASES,
  PROVIDERS,
  type ProviderSpec,
} from "../../packages/provider-registry/src/providers.ts";

type Schema = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  $ref?: string;
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  $defs?: Record<string, Schema>;
};

const schema = JSON.parse(
  readFileSync(new URL("../public/config.schema.json", import.meta.url), "utf8"),
) as Schema & { $id: string };

const escape = (value: string): string => value.replaceAll("|", "\\|").replaceAll("\n", " ");

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
  properties: Record<string, Schema>,
  root: Schema,
  prefix = "",
): Array<{ name: string; schema: Schema }> => {
  const output: Array<{ name: string; schema: Schema }> = [];
  for (const [name, raw] of Object.entries(properties)) {
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

export const configReference = (root: Schema): string => {
  const lines = [
    "## settings reference",
    "",
    `generated from the [hosted JSON Schema](${schema.$id}). add \`\"$schema\": \"${schema.$id}\"\` for editor autocomplete and validation.`,
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
    "## built in",
    "",
    "generated from the provider registry used by model resolution and `glrs doctor`.",
    "",
    "| provider | prefix | credentials `doctor` recognizes | `doctor` also checks | note |",
    "| --- | --- | --- | --- | --- |",
    ...providers.map(
      (provider) =>
        `| ${escape(provider.label)} | \`${provider.id}\` | ${provider.env.map((name) => `\`${name}\``).join(" or ")} | ${(provider.needs ?? []).map((name) => `\`${name}\``).join(", ")} | ${escape(provider.note ?? "")} |`,
    ),
    "",
    "accepted shorthands:",
    "",
    ...Object.entries(aliases).map(([alias, provider]) => `- \`${alias}\` → \`${provider}\``),
  ];
  return `${lines.join("\n")}\n`;
};

const inject = (document: DocumentReflection, marker: string, markdown: string): void => {
  const part = document.content.find((entry) => entry.kind === "text" && entry.text.includes(marker));
  if (part?.kind === "text") part.text = part.text.replace(marker, markdown);
  else document.content.push({ kind: "text", text: `\n${markdown}` });
};

export function load(application: Application): void {
  application.converter.on(
    Converter.EVENT_CREATE_DOCUMENT,
    (_context: undefined, document: DocumentReflection) => {
      const generated = document.frontmatter.generate;
      if (generated === "config-schema")
        inject(document, "<!-- generated:config-schema -->", configReference(schema as Schema));
      if (generated === "providers")
        inject(
          document,
          "<!-- generated:providers -->",
          providerReference(PROVIDERS, PROVIDER_ALIASES),
        );
    },
  );
}
