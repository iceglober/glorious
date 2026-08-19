import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

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

// How much of a message queue one delivery takes. "one-at-a-time" hands over
// the oldest waiting message and leaves the rest; "all" hands over everything
// waiting as a single delivery. Declared here rather than imported from the
// coding agent because config cannot depend on it — see check-boundaries.ts.
export type QueueMode = "one-at-a-time" | "all";

// Which extensions load, and which do not. `load` names a shipped extension or
// a path; `disable` names anything at all and stops it loading. Declared here
// rather than imported from the coding agent for the same reason QueueMode is —
// config cannot depend on it, see check-boundaries.ts.
export type ExtensionSettings = {
  load?: readonly string[];
  disable?: readonly string[];
};

// Tools are not extensions and the two lists have different lifetimes, so this
// is a sibling key rather than a third field above. A name here is withheld
// from the model whichever extension registered it.
export type ToolSettings = {
  disable?: readonly string[];
};

export type Config = {
  // "provider/model-id", e.g. "azure/gpt-5.6-luna". A bare id means azure.
  model?: string;
  // Reasoning effort, when the model advertises one.
  variant?: string;
  // Maximum time in milliseconds for a built-in shell/search tool.
  tool_timeout_ms?: number;
  // Alt+Enter messages, delivered into the turn that is already running.
  steering_mode?: QueueMode;
  // Enter messages, delivered once the agent has finished all its work.
  follow_up_mode?: QueueMode;
  extensions?: ExtensionSettings;
  tools?: ToolSettings;
  // Config is hand-edited by default: nothing glrs does writes it. Listing a
  // section here is how you opt one out of that, so the agent can record an
  // answer you gave it rather than asking you to paste a line every session.
  // Only "extensions" is understood today.
  agentConfigAllowlist?: readonly string[];
  providers?: Record<string, ProviderSettings>;
};

export type LoadedConfig = { config: Config; diagnostics: string[] };

// Project first, then either personal location. `~/.glrs/` is read because
// that is where extensions and commands already come from — the
// ancestor walk reaches it whenever a project sits under home — and having the
// same directory hold resources but not config is a rule nobody should have to
// learn. `~/.config/glrs/` stays for anyone following the XDG layout.
// `home` is a parameter rather than a call to homedir() for the same reason it
// is one in skills.ts: without it a test reads whatever config happens to be
// installed on the machine running it, and homedir() ignores $HOME on Bun so
// there is no way to point it somewhere empty.
// `.glorious` is still read everywhere `.glrs` is, so a checkout that predates
// the rename keeps working without anyone editing anything. Project paths all
// come before personal ones regardless of spelling — a project pinning a model
// in `.glorious/` must still beat your personal `.glrs/`, or the rename would
// quietly reorder precedence rather than just adding a name.
export const configPaths = (root: string, home: string = homedir()): string[] => [
  // `.local.` is the conventional name for the copy you do not commit, so it is
  // the first thing anyone tries and it was silently not a file glrs read.
  join(root, ".glrs", "config.local.json"),
  join(root, ".glrs", "config.json"),
  join(root, ".glorious", "config.local.json"),
  join(root, ".glorious", "config.json"),
  join(home, ".glrs", "config.json"),
  join(home, ".config", "glrs", "config.json"),
  join(home, ".glorious", "config.json"),
  join(home, ".config", "glorious", "config.json"),
];

// Every setting the environment can carry, read as GLRS_<name> first and
// GLORIOUS_<name> after. The rename kept every old variable working rather than
// making a shell-profile edit the price of upgrading; the suffix is the same
// either way, so there is one name here and not two lists to keep level.
export const envSetting = (suffix: string): string | undefined =>
  process.env[`GLRS_${suffix}`] ?? process.env[`GLORIOUS_${suffix}`];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const positiveNumberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const QUEUE_MODES: readonly QueueMode[] = ["one-at-a-time", "all"];

const queueModeOf = (value: unknown): QueueMode | undefined =>
  QUEUE_MODES.includes(value as QueueMode) ? (value as QueueMode) : undefined;

// The camelCase spellings are what the two settings are called in the docs of
// the agent this queue was modelled on, so they are what someone arriving from
// there types first. Reading both costs a line and saves a silent no-op.
const ALSO_KNOWN: Record<string, keyof Config> = {
  steeringMode: "steering_mode",
  followUpMode: "follow_up_mode",
};

// Forgetting an entry here is not cosmetic: a file that configures only
// extensions would be told "nothing here is a glrs setting — the whole file is
// ignored" while the extensions loaded anyway, which is a diagnostic that
// contradicts what happened.
const KNOWN = [
  "model",
  "variant",
  "tool_timeout_ms",
  "steering_mode",
  "follow_up_mode",
  "extensions",
  "tools",
  "agentConfigAllowlist",
  "providers",
  ...Object.keys(ALSO_KNOWN),
];

// Read what is recognised and ignore the rest — a config that has grown a key
// glrs no longer knows about is not a broken config, and refusing to start
// over one would be the worse failure.
//
// But saying nothing is how `{"model": {"selected": "azure/gpt-5.6-sol"}}` ran
// for a week as the default model. The key was recognised and the value was the
// wrong type, so it was dropped exactly as silently as a typo. Anything glrs
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
  // Read under either spelling, and reported under the one that was written so
  // the message points at the line in the file.
  const queueMode = (key: "steering_mode" | "follow_up_mode"): QueueMode | undefined => {
    const alias = Object.keys(ALSO_KNOWN).find((name) => ALSO_KNOWN[name] === key);
    for (const name of [key, alias].filter((one): one is string => one !== undefined)) {
      if (raw[name] === undefined) continue;
      const mode = queueModeOf(raw[name]);
      if (mode === undefined) wrong(name, '"one-at-a-time" or "all"');
      else return mode;
    }
    return undefined;
  };
  // Per entry, not per list: an array with one number in it is a list that half
  // works, and the half that does not is otherwise invisible.
  const names = (value: unknown, block: string, key: string): string[] | undefined => {
    if (value === undefined) return undefined;
    // A top-level list has no inner key, so the label is just its own name.
    const label = key === "" ? block : `${block}.${key}`;
    if (!Array.isArray(value)) {
      diagnostics.push(`${where}: ${label} should be an array of names — ignored`);
      return undefined;
    }
    const kept: string[] = [];
    value.forEach((entry, at) => {
      const name = stringOf(entry);
      if (name === undefined)
        diagnostics.push(`${where}: ${label}[${at}] should be a string — ignored`);
      else kept.push(name.trim());
    });
    return kept.length > 0 ? kept : undefined;
  };

  const listBlock = <T extends Record<string, readonly string[] | undefined>>(
    block: "extensions" | "tools",
    keys: readonly string[],
    wanted: string,
  ): T | undefined => {
    const value = raw[block];
    if (value === undefined) return undefined;
    // `"extensions": ["web-fetch"]` is the shorthand everyone tries first.
    if (Array.isArray(value)) {
      const load = names(value, block, keys[0] ?? "load");
      return load === undefined ? undefined : ({ [keys[0] ?? "load"]: load } as unknown as T);
    }
    if (!isObject(value)) {
      wrong(block, wanted);
      return undefined;
    }
    // A block glrs recognises holding nothing it knows will not do what it
    // looks like it does — the same rule the whole-file check below applies.
    if (!keys.some((key) => key in value)) {
      const inside = Object.keys(value);
      if (inside.length > 0)
        diagnostics.push(
          `${where}: "${block}" has no ${keys.map((key) => `"${key}"`).join(" or ")} (${inside.slice(0, 4).join(", ")}) — ignored`,
        );
      return undefined;
    }
    const out = Object.fromEntries(
      keys
        .map((key) => [key, names(value[key], block, key)])
        .filter(([, list]) => list !== undefined),
    ) as unknown as T;
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const extensions = listBlock<ExtensionSettings>(
    "extensions",
    ["load", "disable"],
    'an object with "load" and "disable", or an array of names',
  );
  const tools = listBlock<ToolSettings>("tools", ["disable"], 'an object with "disable"');
  const allowlist = names(raw.agentConfigAllowlist, "agentConfigAllowlist", "");

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
  // written for something else — an older glrs, or another agent entirely.
  const keys = Object.keys(raw);
  if (keys.length > 0 && !keys.some((key) => KNOWN.includes(key)))
    diagnostics.push(
      `${where}: nothing here is a glrs setting (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}) — the whole file is ignored`,
    );

  return {
    model: stringOf(raw.model),
    variant: stringOf(raw.variant),
    tool_timeout_ms: positiveNumberOf(raw.tool_timeout_ms),
    steering_mode: queueMode("steering_mode"),
    follow_up_mode: queueMode("follow_up_mode"),
    ...(extensions !== undefined ? { extensions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(allowlist !== undefined ? { agentConfigAllowlist: allowlist } : {}),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
  };
};

// Additive, unlike every scalar below. Extensions and tools are sets, not
// values: a project that activates one must not switch off the one your
// personal config activates everywhere, and a name disabled anywhere stays
// disabled — turning something off is the direction that has to be safe.
const union = (near?: readonly string[], far?: readonly string[]): string[] | undefined => {
  const all = [...new Set([...(near ?? []), ...(far ?? [])])];
  return all.length === 0 ? undefined : all;
};

const mergedLists = <T extends Record<string, readonly string[] | undefined>>(
  keys: readonly string[],
  near?: T,
  far?: T,
): T | undefined => {
  const out = Object.fromEntries(
    keys
      .map((key) => [key, union(near?.[key], far?.[key])])
      .filter(([, list]) => list !== undefined),
  ) as unknown as T;
  return Object.keys(out).length > 0 ? out : undefined;
};

const merge = (near: Config, far: Config): Config => ({
  model: near.model ?? far.model,
  variant: near.variant ?? far.variant,
  tool_timeout_ms: near.tool_timeout_ms ?? far.tool_timeout_ms,
  steering_mode: near.steering_mode ?? far.steering_mode,
  follow_up_mode: near.follow_up_mode ?? far.follow_up_mode,
  extensions: mergedLists<ExtensionSettings>(["load", "disable"], near.extensions, far.extensions),
  tools: mergedLists<ToolSettings>(["disable"], near.tools, far.tools),
  // Nearest wins rather than adding up: permission to write your config is not
  // something a project you cloned should be able to widen.
  agentConfigAllowlist: near.agentConfigAllowlist ?? far.agentConfigAllowlist,
  providers: { ...far.providers, ...near.providers },
});

// A path in a config file means a path from that file. Only the prefixes that
// are unambiguously a path are touched; everything else is a name, and a name
// has to survive untouched so the loader can match it against what ships.
export const rooted = (entry: string, from: string, home: string): string =>
  entry.startsWith("~/")
    ? join(home, entry.slice(2))
    : /^\.\.?[/\\]/u.test(entry)
      ? resolve(from, entry)
      : entry;

// Malformed JSON is reported rather than swallowed — a config that silently
// does nothing is the hardest kind to debug. A missing file is not a problem.
export const loadConfig = async (root: string, home: string = homedir()): Promise<LoadedConfig> => {
  const diagnostics: string[] = [];
  const read = async (path: string): Promise<Config> => {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return {};
    try {
      const shaped = shapeOf(JSON.parse(text), path.replace(home, "~"), diagnostics);
      // Resolved here, where the file it came from is still known: the four
      // layers merge into one object a line later, and nothing after that can
      // tell which of them wrote "./tools/reviewer.ts".
      if (shaped.extensions?.load === undefined) return shaped;
      return {
        ...shaped,
        extensions: {
          ...shaped.extensions,
          load: shaped.extensions.load.map((entry) => rooted(entry, dirname(path), home)),
        },
      };
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
