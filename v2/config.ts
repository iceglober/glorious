import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const modelSelectionSchema = z
  .object({
    selected: z.string().optional(),
    variant: z.string().optional(),
  })
  .strict();

export const providerMetadataSchema = z
  .object({
    enabled: z.literal(true).optional(),
    region: z.string().optional(),
    project: z.string().optional(),
    location: z.string().optional(),
  })
  .strict();

const configShape = {
  model: modelSelectionSchema,
  providers: z.record(z.string(), providerMetadataSchema),
};

export const configLayerSchema = z
  .object({
    model: modelSelectionSchema.optional(),
    providers: z.record(z.string(), providerMetadataSchema).optional(),
  })
  .strict();

export const configSchema = z.object(configShape).strict();

export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;
export type Config = z.infer<typeof configSchema>;
export type ConfigLayerConfig = z.infer<typeof configLayerSchema>;
export type ConfigLayer = "defaults" | "global" | "project" | "local";
export type WritableConfigLayer = Exclude<ConfigLayer, "defaults">;
export type ConfigLayers = Record<ConfigLayer, ConfigLayerConfig>;

export type ConfigDiagnostic = {
  layer: WritableConfigLayer;
  path: string;
  kind: "missing" | "malformed" | "invalid";
  message: string;
};

export type ConfigFileSystem = {
  readFile: (path: string) => Promise<string>;
  mkdir: (path: string, options: { recursive: true }) => Promise<void>;
  writeFile: (path: string, contents: string, options: { mode: number }) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string, options: { force: true }) => Promise<void>;
};

const fileSystem: ConfigFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  writeFile,
  rename,
  rm,
};

export type ConfigOptions = {
  globalPath?: string;
  fileSystem?: ConfigFileSystem;
};

export type LoadedConfig = {
  config: Config;
  layers: ConfigLayers;
  diagnostics: ConfigDiagnostic[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const mergeConfig = (...sources: Record<string, unknown>[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const current = result[key];
      result[key] =
        isObject(current) && isObject(value) ? mergeConfig(current, value) : clone(value);
    }
  }
  return result;
};

export const configLayerPath = (
  layer: WritableConfigLayer,
  root: string,
  options: ConfigOptions = {},
): string => {
  if (layer === "global")
    return options.globalPath ?? join(homedir(), ".config", "glorious", "config.json");
  return join(root, ".glorious", layer === "project" ? "config.json" : "config.local.json");
};

const defaults: ConfigLayerConfig = { model: {}, providers: {} };

const readLayer = async (
  layer: WritableConfigLayer,
  root: string,
  options: ConfigOptions,
): Promise<{ config: ConfigLayerConfig; diagnostic?: ConfigDiagnostic }> => {
  const path = configLayerPath(layer, root, options);
  try {
    const text = await (options.fileSystem ?? fileSystem).readFile(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        config: {},
        diagnostic: { layer, path, kind: "malformed", message: "Config file is not valid JSON." },
      };
    }
    const result = configLayerSchema.safeParse(parsed);
    if (!result.success) {
      return {
        config: {},
        diagnostic: {
          layer,
          path,
          kind: "invalid",
          message: result.error.issues[0]?.message ?? "Invalid config.",
        },
      };
    }
    return { config: result.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        config: {},
        diagnostic: { layer, path, kind: "missing", message: "Config file is missing." },
      };
    }
    return {
      config: {},
      diagnostic: { layer, path, kind: "malformed", message: String(error) },
    };
  }
};

export const loadConfig = async (
  root: string,
  options: ConfigOptions = {},
): Promise<LoadedConfig> => {
  const [global, project, local] = await Promise.all(
    (["global", "project", "local"] as const).map((layer) => readLayer(layer, root, options)),
  );
  const layers: ConfigLayers = {
    defaults,
    global: global.config,
    project: project.config,
    local: local.config,
  };
  const diagnostics = [global.diagnostic, project.diagnostic, local.diagnostic].filter(
    (diagnostic): diagnostic is ConfigDiagnostic => diagnostic !== undefined,
  );
  return { config: configSchema.parse(mergeConfig(...Object.values(layers))), layers, diagnostics };
};

const pathParts = (path: string | readonly string[]): readonly string[] =>
  typeof path === "string" ? path.split(".").filter(Boolean) : path;

export const configProvenance = (
  layers: ConfigLayers,
  path: string | readonly string[],
): ConfigLayer | undefined => {
  const parts = pathParts(path);
  for (const layer of ["local", "project", "global", "defaults"] as const) {
    let current: unknown = layers[layer];
    let found = true;
    for (const part of parts) {
      if (!isObject(current) || !Object.hasOwn(current, part)) {
        found = false;
        break;
      }
      current = current[part];
    }
    if (found) return layer;
  }
  return undefined;
};

export type ConfigLayerMutation =
  | ConfigLayerConfig
  | ((current: ConfigLayerConfig) => ConfigLayerConfig);

export const writeConfigLayer = async (
  layer: WritableConfigLayer,
  root: string,
  mutation: ConfigLayerMutation,
  options: ConfigOptions = {},
): Promise<void> => {
  const current = await readLayer(layer, root, options);
  const changed =
    typeof mutation === "function"
      ? mutation(clone(current.config))
      : mergeConfig(current.config, mutation);
  const config = configLayerSchema.parse(changed);
  const path = configLayerPath(layer, root, options);
  const fs = options.fileSystem ?? fileSystem;
  const temporary = join(dirname(path), `.config-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, path);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};
