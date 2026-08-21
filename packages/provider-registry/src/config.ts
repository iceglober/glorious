import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { settingsFor } from "./providers";

// Three scopes, nearest value wins: Project-User, Project, then User. Config is
// hand-edited unless configuration explicitly allows glrs to record extension choices.

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

type JsonConfig<T> = T extends string | number | boolean | null
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer Item)[]
      ? JsonConfig<Item>[]
      : T extends object
        ? {
            [Key in keyof T as JsonConfig<T[Key]> extends never ? never : Key]: JsonConfig<T[Key]>;
          }
        : never;

type OpenAIProviderOptions =
  | import("@ai-sdk/openai").OpenAIChatLanguageModelOptions
  | import("@ai-sdk/openai").OpenAIResponsesProviderOptions;

/** Provider option types sourced from installed AI SDK provider packages. */
export type ProviderCallOptionsById = {
  anthropic: JsonConfig<import("@ai-sdk/anthropic").AnthropicProviderOptions> & JsonObject;
  azure: JsonConfig<OpenAIProviderOptions> & JsonObject;
  bedrock: JsonConfig<import("@ai-sdk/amazon-bedrock").BedrockProviderOptions> & JsonObject;
  cohere: JsonConfig<import("@ai-sdk/cohere").CohereLanguageModelOptions> & JsonObject;
  deepseek: JsonConfig<import("@ai-sdk/deepseek").DeepSeekLanguageModelOptions> & JsonObject;
  google: JsonConfig<import("@ai-sdk/google").GoogleGenerativeAIProviderOptions> & JsonObject;
  groq: JsonConfig<import("@ai-sdk/groq").GroqProviderOptions> & JsonObject;
  mistral: JsonConfig<import("@ai-sdk/mistral").MistralLanguageModelOptions> & JsonObject;
  openai: JsonConfig<OpenAIProviderOptions> & JsonObject;
  openrouter: JsonConfig<import("@openrouter/ai-sdk-provider").OpenRouterProviderOptions> &
    JsonObject;
  perplexity: JsonConfig<import("@ai-sdk/perplexity").PerplexityLanguageModelOptions> & JsonObject;
  xai: JsonConfig<
    import("@ai-sdk/xai").XaiProviderOptions | import("@ai-sdk/xai").XaiResponsesProviderOptions
  > &
    JsonObject;
};

export type ProviderCallOptions = Record<string, JsonObject> & {
  [Id in keyof ProviderCallOptionsById]?: ProviderCallOptionsById[Id];
};

export type RequestSettings = JsonConfig<
  Omit<import("ai").CallSettings & import("ai").RequestOptions, "abortSignal" | "providerOptions">
> &
  JsonObject;

export type ModelMetadataSettings = {
  name?: string;
  context?: number;
  inputCost?: number;
  outputCost?: number;
  variants?: string[];
};

export type ModelSettings = {
  requestOptions?: RequestSettings;
  providerOptions?: ProviderCallOptions;
  metadata?: ModelMetadataSettings;
};

export type ProviderSettings<FactoryOptions extends JsonObject = JsonObject> = {
  /** Options passed directly to the installed AI SDK provider factory. */
  factoryOptions?: FactoryOptions;
  /** Standard JSON-compatible AI SDK call options applied to every model call. */
  requestOptions?: RequestSettings;
  /** AI SDK provider options, including their provider namespace. */
  providerOptions?: ProviderCallOptions;
  /** Exact model-id overrides. */
  models?: Record<string, ModelSettings>;
  // Compatibility conveniences. These become provider factory options.
  api?: string;
  region?: string;
  project?: string;
  location?: string;
};

type FactoryOptions<F extends (...args: never[]) => unknown> = NonNullable<Parameters<F>[0]>;
type JsonFactoryOptions<T> = JsonConfig<Omit<T, "fetch">> & JsonObject;

/** Factory option types sourced from the installed AI SDK provider packages. */
export type ProviderFactoryOptionsById = {
  "amazon-bedrock": JsonFactoryOptions<
    FactoryOptions<typeof import("@ai-sdk/amazon-bedrock").createAmazonBedrock>
  >;
  anthropic: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/anthropic").createAnthropic>>;
  azure: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/azure").createAzure>>;
  cerebras: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/cerebras").createCerebras>>;
  cohere: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/cohere").createCohere>>;
  deepseek: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/deepseek").createDeepSeek>>;
  google: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/google").createGoogle>>;
  "google-vertex": JsonFactoryOptions<
    FactoryOptions<typeof import("@ai-sdk/google-vertex").createGoogleVertex>
  >;
  groq: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/groq").createGroq>>;
  mistral: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/mistral").createMistral>>;
  openai: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/openai").createOpenAI>>;
  openrouter: JsonFactoryOptions<
    FactoryOptions<typeof import("@openrouter/ai-sdk-provider").createOpenRouter>
  >;
  perplexity: JsonFactoryOptions<
    FactoryOptions<typeof import("@ai-sdk/perplexity").createPerplexity>
  >;
  togetherai: JsonFactoryOptions<
    FactoryOptions<typeof import("@ai-sdk/togetherai").createTogetherAI>
  >;
  xai: JsonFactoryOptions<FactoryOptions<typeof import("@ai-sdk/xai").createXai>>;
};

export type ProvidersSettings = Record<string, ProviderSettings> & {
  [Id in keyof ProviderFactoryOptionsById]?: ProviderSettings<ProviderFactoryOptionsById[Id]>;
};

// How much of a message queue one delivery takes. "one-at-a-time" hands over
// the oldest waiting message and leaves the rest; "all" hands over everything
// waiting as a single delivery. Declared here rather than imported from the
// coding agent because config cannot depend on it — see check-boundaries.ts.
export type QueueMode = "one-at-a-time" | "all";

export const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
export type ReasoningDisplay = boolean | ReasoningLevel;

// Which extensions load, and which do not. `load` names a first-party extension or
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
  // Required at runtime as "provider/model-id"; bare ids are rejected.
  model?: string;
  // Reasoning effort, when the model advertises one.
  variant?: string;
  // Show provider-supplied reasoning, optionally only at or above one effort.
  reasoningDisplay?: ReasoningDisplay;
  // Maximum time in milliseconds for a built-in shell/search tool.
  toolTimeoutMs?: number;
  // Alt+Enter messages, delivered into the turn that is already running.
  steeringMode?: QueueMode;
  // Enter messages, delivered once the agent has finished all its work.
  followUpMode?: QueueMode;
  extensions?: ExtensionSettings;
  tools?: ToolSettings;
  // Config is hand-edited by default: nothing glrs does writes it. Listing a
  // section here is how you opt one out of that, so the agent can record an
  // answer you gave it rather than asking you to paste a line every session.
  // Only "extensions" is understood today.
  agentConfigAllowlist?: readonly string[];
  providers?: ProvidersSettings;
};

export type LoadedConfig = { config: Config; diagnostics: string[] };

export const CONFIG_SCHEMA_URL = "https://glrs.dev/config.schema.json";
const initialConfig = `${JSON.stringify({ $schema: CONFIG_SCHEMA_URL }, null, 2)}\n`;

const userConfigBase = (
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string => {
  const paths = platform === "win32" ? win32 : { join, resolve };
  if (env.XDG_CONFIG_HOME) return paths.resolve(env.XDG_CONFIG_HOME);
  if (platform === "win32")
    return paths.resolve(env.APPDATA ?? paths.join(home, "AppData", "Roaming"));
  return paths.join(home, ".config");
};

// One User directory holds every user-scoped glrs resource: config,
// extensions, commands and skills. An explicit glrs override wins, then the XDG
// convention, then the platform-native default. APPDATA is Windows's roaming
// configuration directory; LOCALAPPDATA is deliberately not used for config.
export const userConfigDirectory = (
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string => {
  const paths = platform === "win32" ? win32 : { join, resolve };
  if (env.GLRS_CONFIG_HOME) return paths.resolve(env.GLRS_CONFIG_HOME);
  return paths.join(userConfigBase(home, env, platform), "glrs");
};

// The three scopes, nearest first: Project-User is the gitignored local copy,
// Project is committed with the repository, and User applies across projects.
// `home`, `env` and `platform` are parameters so tests never read the config of
// the machine running them.
export const configPaths = (
  root: string,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  const paths = platform === "win32" ? win32 : { join };
  return [
    paths.join(root, ".glrs", "config.local.json"),
    paths.join(root, ".glrs", "config.json"),
    paths.join(userConfigDirectory(home, env, platform), "config.json"),
  ];
};

export const configScopes = (
  root: string,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Array<{ name: "Project-User" | "Project" | "User"; path: string }> =>
  configPaths(root, home, env, platform).map((path, index) => ({
    name: (["Project-User", "Project", "User"] as const)[index],
    path,
  }));

const withSchema = (text: string): string | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(raw) || Object.hasOwn(raw, "$schema")) return undefined;

  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  const inside = text.slice(open + 1, close);
  const property = `${JSON.stringify("$schema")}: ${JSON.stringify(CONFIG_SCHEMA_URL)}`;
  if (inside.trim() === "") {
    const newline = inside.includes("\r\n") ? "\r\n" : inside.includes("\n") ? "\n" : undefined;
    const replacement =
      newline === undefined
        ? `${inside}${property}${inside}`
        : `${newline}  ${property}${newline}${inside.slice(inside.lastIndexOf(newline) + newline.length)}`;
    return `${text.slice(0, open + 1)}${replacement}${text.slice(close)}`;
  }

  const leading = /^\s*/u.exec(inside)?.[0] ?? "";
  return `${text.slice(0, open + 1)}${leading}${property},${leading}${inside.slice(leading.length)}${text.slice(close)}`;
};

const addSchema = async (path: string): Promise<void> => {
  const text = await readFile(path, "utf8");
  const updated = withSchema(text);
  if (updated !== undefined) await writeFile(path, updated, "utf8");
};

export const ensureConfigFiles = async (
  root: string,
  options: {
    project: boolean;
    home?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  },
): Promise<string[]> => {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const scopes = configScopes(root, home, env, platform);
  const targets = options.project ? scopes : scopes.filter((scope) => scope.name === "User");
  if (options.project) {
    const projectDirectory = dirname(scopes[0].path);
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(join(projectDirectory, ".gitignore"), "/config.local.json\n", {
      encoding: "utf8",
      flag: "wx",
    }).catch((thrown) => {
      if ((thrown as NodeJS.ErrnoException).code !== "EEXIST") throw thrown;
    });
  }
  const created: string[] = [];
  for (const target of targets) {
    await mkdir(dirname(target.path), { recursive: true });
    try {
      await writeFile(target.path, initialConfig, { encoding: "utf8", flag: "wx" });
      created.push(target.path);
    } catch (thrown) {
      if ((thrown as NodeJS.ErrnoException).code !== "EEXIST") throw thrown;
      await addSchema(target.path);
    }
  }
  return created;
};

export const glrsDirectories = (
  root: string,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  const paths = platform === "win32" ? win32 : { join };
  return [paths.join(root, ".glrs"), userConfigDirectory(home, env, platform)];
};

export const agentSkillsDirectories = (
  root: string,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  const paths = platform === "win32" ? win32 : { join };
  return [
    paths.join(root, ".agents", "skills"),
    paths.join(userConfigBase(home, env, platform), "agents", "skills"),
  ];
};

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

const AGENT_OWNED_REQUEST_OPTIONS = new Set([
  "model",
  "instructions",
  "system",
  "prompt",
  "messages",
  "allowSystemInMessages",
  "tools",
  "toolChoice",
  "activeTools",
  "toolOrder",
  "toolApproval",
  "experimental_toolApprovalSecret",
  "abortSignal",
  "prepareStep",
  "repairToolCall",
  "experimental_repairToolCall",
  "experimental_refineToolInput",
  "experimental_transform",
  "experimental_download",
  "output",
  "includeRawChunks",
  "onChunk",
  "onError",
  "onStart",
  "experimental_onStart",
  "onStepStart",
  "experimental_onStepStart",
  "onFinish",
  "onEnd",
  "onAbort",
  "onStepEnd",
  "onStepFinish",
  "onLanguageModelCallStart",
  "experimental_onLanguageModelCallStart",
  "onLanguageModelCallEnd",
  "experimental_onLanguageModelCallEnd",
  "onToolExecutionStart",
  "onToolExecutionEnd",
  "experimental_onToolCallStart",
  "experimental_onToolCallFinish",
  "providerOptions",
  "stopWhen",
  "runtimeContext",
  "toolsContext",
  "_internal",
]);

const queueModeOf = (value: unknown): QueueMode | undefined =>
  QUEUE_MODES.includes(value as QueueMode) ? (value as QueueMode) : undefined;

// Forgetting an entry here is not cosmetic: a file that configures only
// extensions would be told "nothing here is a glrs setting — the whole file is
// ignored" while the extensions loaded anyway, which is a diagnostic that
// contradicts what happened.
const KNOWN = [
  "$schema",
  "model",
  "variant",
  "reasoningDisplay",
  "toolTimeoutMs",
  "steeringMode",
  "followUpMode",
  "extensions",
  "tools",
  "agentConfigAllowlist",
  "providers",
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
  const reasoningDisplay = (() => {
    if (raw.reasoningDisplay === undefined) return undefined;
    if (typeof raw.reasoningDisplay === "boolean") return raw.reasoningDisplay;
    if (
      typeof raw.reasoningDisplay === "string" &&
      REASONING_LEVELS.includes(raw.reasoningDisplay as ReasoningLevel)
    )
      return raw.reasoningDisplay as ReasoningLevel;
    wrong("reasoningDisplay", "true, false, or a reasoning level");
    return undefined;
  })();
  if (raw.toolTimeoutMs !== undefined && positiveNumberOf(raw.toolTimeoutMs) === undefined)
    wrong("toolTimeoutMs", "a positive number");
  const queueMode = (key: "steeringMode" | "followUpMode"): QueueMode | undefined => {
    const mode = queueModeOf(raw[key]);
    if (raw[key] !== undefined && mode === undefined) wrong(key, '"one-at-a-time" or "all"');
    return mode;
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

  const requestOptions = (value: unknown, path: string): JsonObject | undefined => {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
      diagnostics.push(`${where}: ${path} should be an object — ignored`);
      return undefined;
    }
    const kept = { ...value } as JsonObject;
    for (const key of AGENT_OWNED_REQUEST_OPTIONS)
      if (Object.hasOwn(kept, key)) {
        delete kept[key];
        diagnostics.push(`${where}: ${path}.${key} is owned by glrs — ignored`);
      }
    return kept;
  };

  const providerOptions = (
    value: unknown,
    path: string,
  ): Record<string, JsonObject> | undefined => {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
      diagnostics.push(`${where}: ${path} should be an object — ignored`);
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(value).flatMap(([namespace, options]) => {
        // null is JSON Merge Patch's deletion marker and has to survive until
        // the three scopes are combined.
        if (options === null || isObject(options)) return [[namespace, options]];
        diagnostics.push(`${where}: ${path}.${namespace} should be an object — ignored`);
        return [];
      }),
    ) as Record<string, JsonObject>;
  };

  const modelMetadata = (value: unknown, path: string): ModelMetadataSettings | undefined => {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
      diagnostics.push(`${where}: ${path} should be an object — ignored`);
      return undefined;
    }
    const metadata: Record<string, unknown> = {};
    const keep = (
      key: "name" | "context" | "inputCost" | "outputCost",
      valid: (candidate: unknown) => boolean,
      wanted: string,
    ): void => {
      if (value[key] === undefined) return;
      if (value[key] === null || valid(value[key])) metadata[key] = value[key];
      else diagnostics.push(`${where}: ${path}.${key} should be ${wanted} — ignored`);
    };
    keep("name", (candidate) => stringOf(candidate) !== undefined, "a non-empty string");
    keep("context", (candidate) => positiveNumberOf(candidate) !== undefined, "a positive number");
    keep(
      "inputCost",
      (candidate) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0,
      "a non-negative number",
    );
    keep(
      "outputCost",
      (candidate) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0,
      "a non-negative number",
    );
    if (value.variants === null) metadata.variants = null;
    else if (value.variants !== undefined) {
      if (!Array.isArray(value.variants))
        diagnostics.push(`${where}: ${path}.variants should be an array of strings — ignored`);
      else {
        const variants = value.variants.flatMap((candidate, index) => {
          const variant = stringOf(candidate);
          if (variant !== undefined) return [variant];
          diagnostics.push(`${where}: ${path}.variants[${index}] should be a string — ignored`);
          return [];
        });
        metadata.variants = variants;
      }
    }
    return metadata as ModelMetadataSettings;
  };

  const providers: Record<string, ProviderSettings> = {};
  if (isObject(raw.providers))
    for (const [name, value] of Object.entries(raw.providers)) {
      if (!isObject(value)) {
        diagnostics.push(`${where}: providers.${name} should be an object — ignored`);
        continue;
      }
      const provider = { ...value } as ProviderSettings;
      const providerRequests = requestOptions(
        value.requestOptions,
        `providers.${name}.requestOptions`,
      );
      if (providerRequests === undefined) delete provider.requestOptions;
      else provider.requestOptions = providerRequests;
      if (value.factoryOptions !== undefined && !isObject(value.factoryOptions)) {
        diagnostics.push(
          `${where}: providers.${name}.factoryOptions should be an object — ignored`,
        );
        delete provider.factoryOptions;
      } else if (isObject(value.factoryOptions)) {
        provider.factoryOptions = { ...value.factoryOptions } as JsonObject;
        if (Object.hasOwn(provider.factoryOptions, "fetch")) {
          delete provider.factoryOptions.fetch;
          diagnostics.push(
            `${where}: providers.${name}.factoryOptions.fetch is owned by glrs — ignored`,
          );
        }
      }
      const providerCallOptions = providerOptions(
        value.providerOptions,
        `providers.${name}.providerOptions`,
      );
      if (providerCallOptions === undefined) delete provider.providerOptions;
      else provider.providerOptions = providerCallOptions;
      if (value.models !== undefined && !isObject(value.models)) {
        diagnostics.push(`${where}: providers.${name}.models should be an object — ignored`);
        delete provider.models;
      } else if (isObject(value.models)) {
        provider.models = Object.fromEntries(
          Object.entries(value.models).flatMap(([modelId, model]) => {
            if (!isObject(model)) {
              diagnostics.push(
                `${where}: providers.${name}.models.${modelId} should be an object — ignored`,
              );
              return [];
            }
            const configured = { ...model } as ModelSettings;
            const modelRequests = requestOptions(
              model.requestOptions,
              `providers.${name}.models.${modelId}.requestOptions`,
            );
            if (modelRequests === undefined) delete configured.requestOptions;
            else configured.requestOptions = modelRequests;
            const modelProviderOptions = providerOptions(
              model.providerOptions,
              `providers.${name}.models.${modelId}.providerOptions`,
            );
            if (modelProviderOptions === undefined) delete configured.providerOptions;
            else configured.providerOptions = modelProviderOptions;
            const metadata = modelMetadata(
              model.metadata,
              `providers.${name}.models.${modelId}.metadata`,
            );
            if (metadata === undefined) delete configured.metadata;
            else configured.metadata = metadata;
            return [[modelId, configured]];
          }),
        ) as Record<string, ModelSettings>;
      }
      for (const key of ["api", "region", "project", "location"] as const)
        if (provider[key] !== undefined && !settingsFor(name).includes(key)) {
          diagnostics.push(`${where}: providers.${name}.${key} is not used by ${name} — ignored`);
          delete provider[key];
        }
      providers[name] = provider;
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
    reasoningDisplay,
    toolTimeoutMs: positiveNumberOf(raw.toolTimeoutMs),
    steeringMode: queueMode("steeringMode"),
    followUpMode: queueMode("followUpMode"),
    ...(extensions !== undefined ? { extensions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(allowlist !== undefined ? { agentConfigAllowlist: allowlist } : {}),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
  };
};

// Additive, unlike every scalar below. Extensions and tools are sets, not
// values: a project that activates one must not switch off the one your
// User config activates everywhere, and a name disabled anywhere stays
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

const removed = Symbol("removed");
const mergeJson = (far: unknown, near: unknown): unknown | typeof removed => {
  if (near === null) return removed;
  if (!isObject(near)) return near;
  const output: Record<string, unknown> = isObject(far) ? { ...far } : {};
  for (const [key, value] of Object.entries(near)) {
    const merged = mergeJson(output[key], value);
    if (merged === removed) delete output[key];
    else output[key] = merged;
  }
  return output;
};

const merge = (near: Config, far: Config): Config => ({
  model: near.model ?? far.model,
  variant: near.variant ?? far.variant,
  reasoningDisplay: near.reasoningDisplay ?? far.reasoningDisplay,
  toolTimeoutMs: near.toolTimeoutMs ?? far.toolTimeoutMs,
  steeringMode: near.steeringMode ?? far.steeringMode,
  followUpMode: near.followUpMode ?? far.followUpMode,
  extensions: mergedLists<ExtensionSettings>(["load", "disable"], near.extensions, far.extensions),
  tools: mergedLists<ToolSettings>(["disable"], near.tools, far.tools),
  // Nearest wins rather than adding up: permission to write your config is not
  // something a project you cloned should be able to widen.
  agentConfigAllowlist: near.agentConfigAllowlist ?? far.agentConfigAllowlist,
  providers: mergeJson(far.providers ?? {}, near.providers ?? {}) as ProvidersSettings,
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
export const loadConfig = async (
  root: string,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<LoadedConfig> => {
  const diagnostics: string[] = [];
  const read = async (path: string): Promise<Config> => {
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) return {};
    try {
      const shaped = shapeOf(JSON.parse(text), path.replace(home, "~"), diagnostics);
      // Resolved here, where the file it came from is still known: the three
      // scopes merge into one object a line later, and nothing after that can
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
  // Nearest wins, one key at a time: Project may pin the model while User
  // supplies provider settings it does not mention.
  const layers = await Promise.all(configPaths(root, home, env, platform).map(read));
  return { config: layers.reduce((near, far) => merge(near, far)), diagnostics };
};
