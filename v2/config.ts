import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Two files, read-only, no schema. The four-layer merge with provenance
// tracking that used to live here served two fields once the model picker and
// MCP were gone; a project file and a personal one, project wins, is the whole
// of it. Nothing writes config at runtime any more — you edit the file.

export type ProviderSettings = {
  // Base URL, for an OpenAI-compatible endpoint that is not one of the named
  // providers.
  api?: string;
  // amazon-bedrock
  region?: string;
  // google-vertex
  project?: string;
  location?: string;
};

export type Config = {
  // "provider/model-id", e.g. "azure/gpt-5.6-luna". A bare id means azure.
  model?: string;
  // Reasoning effort, when the model advertises one.
  variant?: string;
  providers?: Record<string, ProviderSettings>;
};

export type LoadedConfig = { config: Config; diagnostics: string[] };

// Project first, then either personal location. `~/.glorious/` is read because
// that is where extensions, sequences and commands already come from — the
// ancestor walk reaches it whenever a project sits under home — and having the
// same directory hold resources but not config is a rule nobody should have to
// learn. `~/.config/glorious/` stays for anyone following the XDG layout.
export const configPaths = (root: string): string[] => [
  join(root, ".glorious", "config.json"),
  join(homedir(), ".glorious", "config.json"),
  join(homedir(), ".config", "glorious", "config.json"),
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

// Read what is recognised and ignore the rest. A config file that has grown a
// key glorious no longer knows about is not a broken config — refusing to start
// over one would be the worse failure.
const shapeOf = (raw: unknown): Config => {
  if (!isObject(raw)) return {};
  const providers: Record<string, ProviderSettings> = {};
  if (isObject(raw.providers))
    for (const [name, value] of Object.entries(raw.providers)) {
      if (!isObject(value)) continue;
      providers[name] = {
        api: stringOf(value.api),
        region: stringOf(value.region),
        project: stringOf(value.project),
        location: stringOf(value.location),
      };
    }
  return {
    model: stringOf(raw.model),
    variant: stringOf(raw.variant),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
  };
};

const merge = (near: Config, far: Config): Config => ({
  model: near.model ?? far.model,
  variant: near.variant ?? far.variant,
  providers: { ...far.providers, ...near.providers },
});

// Malformed JSON is reported rather than swallowed — a config that silently
// does nothing is the hardest kind to debug. A missing file is not a problem.
export const loadConfig = async (root: string): Promise<LoadedConfig> => {
  const diagnostics: string[] = [];
  const read = async (path: string): Promise<Config> => {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return {};
    try {
      return shapeOf(JSON.parse(text));
    } catch {
      diagnostics.push(`${path}: not valid JSON, ignored`);
      return {};
    }
  };
  // Nearest wins, one key at a time: a project may pin the model while personal
  // config supplies the provider settings it does not mention.
  const layers = await Promise.all(configPaths(root).map(read));
  return { config: layers.reduce((near, far) => merge(near, far)), diagnostics };
};
