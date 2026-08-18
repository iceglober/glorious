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
  // Maximum time in milliseconds for a built-in shell/search tool.
  tool_timeout_ms?: number;
  providers?: Record<string, ProviderSettings>;
};

export type LoadedConfig = { config: Config; diagnostics: string[] };

// Project first, then either personal location. `~/.glorious/` is read because
// that is where extensions and commands already come from — the
// ancestor walk reaches it whenever a project sits under home — and having the
// same directory hold resources but not config is a rule nobody should have to
// learn. `~/.config/glorious/` stays for anyone following the XDG layout.
// `home` is a parameter rather than a call to homedir() for the same reason it
// is one in skills.ts: without it a test reads whatever config happens to be
// installed on the machine running it, and homedir() ignores $HOME on Bun so
// there is no way to point it somewhere empty.
export const configPaths = (root: string, home: string = homedir()): string[] => [
  // `.local.` is the conventional name for the copy you do not commit, so it is
  // the first thing anyone tries and it was silently not a file glorious read.
  join(root, ".glorious", "config.local.json"),
  join(root, ".glorious", "config.json"),
  join(home, ".glorious", "config.json"),
  join(home, ".config", "glorious", "config.json"),
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const positiveNumberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const KNOWN = ["model", "variant", "tool_timeout_ms", "providers"];

// Read what is recognised and ignore the rest — a config that has grown a key
// glorious no longer knows about is not a broken config, and refusing to start
// over one would be the worse failure.
//
// But saying nothing is how `{"model": {"selected": "azure/gpt-5.6-sol"}}` ran
// for a week as the default model. The key was recognised and the value was the
// wrong type, so it was dropped exactly as silently as a typo. Anything glorious
// knows the name of and cannot use now says so, and a file where it recognised
// nothing at all says that too.
const shapeOf = (raw: unknown, where: string, diagnostics: string[]): Config => {
  if (!isObject(raw)) {
    diagnostics.push(`${where}: expected a JSON object, ignored`);
    return {};
  }
  const wrong = (key: string, wanted: string): void => {
    diagnostics.push(
      `${where}: "${key}" should be ${wanted}, got ${Array.isArray(raw[key]) ? "an array" : typeof raw[key]} — ignored`,
    );
  };
  if (raw.model !== undefined && stringOf(raw.model) === undefined)
    wrong("model", 'a string like "azure/gpt-5.6-sol"');
  if (raw.variant !== undefined && stringOf(raw.variant) === undefined)
    wrong("variant", 'a string like "high"');
  if (raw.tool_timeout_ms !== undefined && positiveNumberOf(raw.tool_timeout_ms) === undefined)
    wrong("tool_timeout_ms", "a positive number");
  if (raw.providers !== undefined && !isObject(raw.providers)) wrong("providers", "an object");

  const providers: Record<string, ProviderSettings> = {};
  if (isObject(raw.providers))
    for (const [name, value] of Object.entries(raw.providers)) {
      if (!isObject(value)) {
        diagnostics.push(`${where}: providers.${name} should be an object — ignored`);
        continue;
      }
      providers[name] = {
        api: stringOf(value.api),
        region: stringOf(value.region),
        project: stringOf(value.project),
        location: stringOf(value.location),
      };
    }

  // A file full of keys, none of which mean anything here, is almost always one
  // written for something else — an older glorious, or another agent entirely.
  const keys = Object.keys(raw);
  if (keys.length > 0 && !keys.some((key) => KNOWN.includes(key)))
    diagnostics.push(
      `${where}: nothing here is a glorious setting (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}) — the whole file is ignored`,
    );

  return {
    model: stringOf(raw.model),
    variant: stringOf(raw.variant),
    tool_timeout_ms: positiveNumberOf(raw.tool_timeout_ms),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
  };
};

const merge = (near: Config, far: Config): Config => ({
  model: near.model ?? far.model,
  variant: near.variant ?? far.variant,
  tool_timeout_ms: near.tool_timeout_ms ?? far.tool_timeout_ms,
  providers: { ...far.providers, ...near.providers },
});

// Malformed JSON is reported rather than swallowed — a config that silently
// does nothing is the hardest kind to debug. A missing file is not a problem.
export const loadConfig = async (root: string, home: string = homedir()): Promise<LoadedConfig> => {
  const diagnostics: string[] = [];
  const read = async (path: string): Promise<Config> => {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return {};
    try {
      return shapeOf(JSON.parse(text), path.replace(home, "~"), diagnostics);
    } catch {
      diagnostics.push(`${path.replace(home, "~")}: not valid JSON, ignored`);
      return {};
    }
  };
  // Nearest wins, one key at a time: a project may pin the model while personal
  // config supplies the provider settings it does not mention.
  const layers = await Promise.all(configPaths(root, home).map(read));
  return { config: layers.reduce((near, far) => merge(near, far)), diagnostics };
};
