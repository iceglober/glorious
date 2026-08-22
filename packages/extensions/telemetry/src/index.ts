import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import type { Attributes, Counter, Histogram } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { EventPayload, Glrs, Line } from "../../../glrs-core/src";

export type TelemetryConsent = true | false | undefined;

type Metric = {
  name: string;
  value: number;
  attributes: Attributes;
  kind: "counter" | "histogram";
};
export type MetricSink = { record: (metric: Metric) => void; shutdown: () => Promise<void> };

const disabledValue = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

export const telemetrySuppressed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  disabledValue(env.DO_NOT_TRACK) ||
  disabledValue(env.DNT) ||
  disabledValue(env.OTEL_SDK_DISABLED) ||
  env.OTEL_METRICS_EXPORTER?.toLowerCase() === "none";

const configBase = (home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string => {
  const paths = platform === "win32" ? win32 : { join, resolve };
  if (env.GLRS_CONFIG_HOME) return paths.resolve(env.GLRS_CONFIG_HOME);
  if (env.XDG_CONFIG_HOME) return paths.resolve(env.XDG_CONFIG_HOME);
  if (platform === "win32")
    return paths.resolve(env.APPDATA ?? paths.join(home, "AppData", "Roaming"));
  return paths.join(home, ".config");
};

export const telemetryConfigPath = (
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string =>
  (platform === "win32" ? win32 : { join }).join(
    configBase(home, env, platform),
    "glrs",
    "config.json",
  );

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readTelemetryConsent = async (
  path: string = telemetryConfigPath(),
): Promise<TelemetryConsent> => {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!object(raw) || !object(raw.telemetry)) return undefined;
    return typeof raw.telemetry.enabled === "boolean" ? raw.telemetry.enabled : undefined;
  } catch {
    return undefined;
  }
};

export const writeTelemetryConsent = async (
  enabled: boolean,
  path: string = telemetryConfigPath(),
): Promise<boolean> => {
  let raw: Record<string, unknown> = {};
  try {
    const existing = await readFile(path, "utf8").catch(() => "");
    if (existing !== "") {
      const parsed: unknown = JSON.parse(existing);
      if (!object(parsed)) return false;
      raw = parsed;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ ...raw, telemetry: { ...(object(raw.telemetry) ? raw.telemetry : {}), enabled } }, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
};

export const otlpEndpoint = (env: NodeJS.ProcessEnv): string | undefined => {
  const metricsEndpoint = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
  if (metricsEndpoint) return metricsEndpoint;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/$/u, "");
  return base ? `${base}/v1/metrics` : undefined;
};

export const otlpHeaders = (value: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (value ?? "").split(",").flatMap((part) => {
      const at = part.indexOf("=");
      if (at < 1) return [];
      return [
        [
          decodeURIComponent(part.slice(0, at).trim()),
          decodeURIComponent(part.slice(at + 1).trim()),
        ],
      ];
    }),
  );

export const measurementsFor = (usage: EventPayload["usage"]): Metric[] => {
  if (!usage.provider || !usage.endpoint || !usage.cacheStrategy || !usage.cacheTelemetry)
    return [];
  const attributes = {
    "gen_ai.provider.name": usage.provider.slice(0, 64),
    "gen_ai.operation.name": "chat",
    "glrs.endpoint.type": usage.endpoint,
    "glrs.cache.strategy": usage.cacheStrategy,
    "glrs.cache.telemetry": usage.cacheTelemetry,
  };
  const cacheResult = !usage.reusablePrefix
    ? "ineligible"
    : usage.cacheRead === undefined
      ? "unreported"
      : usage.cacheRead > 0
        ? "hit"
        : "miss";
  const withResult = { ...attributes, "glrs.cache.result": cacheResult };
  const measurements: Metric[] = [
    { name: "glrs.model.requests", value: 1, attributes: withResult, kind: "counter" },
    {
      name: "gen_ai.client.token.usage",
      value: usage.input,
      attributes: { ...attributes, "gen_ai.token.type": "input" },
      kind: "histogram",
    },
    {
      name: "gen_ai.client.token.usage",
      value: usage.output,
      attributes: { ...attributes, "gen_ai.token.type": "output" },
      kind: "histogram",
    },
  ];
  if (usage.durationMs !== undefined)
    measurements.push({
      name: "gen_ai.client.operation.duration",
      value: usage.durationMs / 1000,
      attributes,
      kind: "histogram",
    });
  if (usage.cacheRead !== undefined)
    measurements.push({
      name: "glrs.gen_ai.client.cache.tokens",
      value: usage.cacheRead,
      attributes: { ...attributes, "glrs.cache.type": "read" },
      kind: "histogram",
    });
  if (usage.cacheWrite !== undefined)
    measurements.push({
      name: "glrs.gen_ai.client.cache.tokens",
      value: usage.cacheWrite,
      attributes: { ...attributes, "glrs.cache.type": "write" },
      kind: "histogram",
    });
  return measurements;
};

export const createOtelSink = (env: NodeJS.ProcessEnv = process.env): MetricSink | undefined => {
  const endpoint = otlpEndpoint(env);
  if (!endpoint) return undefined;
  try {
    const exporter = new OTLPMetricExporter({
      url: endpoint,
      headers: otlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    });
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: Number(env.OTEL_METRIC_EXPORT_INTERVAL) || 60_000,
    });
    const provider = new MeterProvider({
      resource: resourceFromAttributes({ "service.name": "glrs" }),
      readers: [reader],
    });
    const meter = provider.getMeter("glrs");
    const counters = new Map<string, Counter>();
    const histograms = new Map<string, Histogram>();
    return {
      record(metric) {
        try {
          if (!Number.isFinite(metric.value) || metric.value < 0) return;
          if (metric.kind === "counter") {
            const instrument =
              counters.get(metric.name) ??
              meter.createCounter(metric.name, {
                unit: "{request}",
              });
            counters.set(metric.name, instrument);
            instrument.add(metric.value, metric.attributes);
          } else {
            const instrument =
              histograms.get(metric.name) ??
              meter.createHistogram(metric.name, {
                unit: metric.name.includes("token") ? "{token}" : "s",
              });
            histograms.set(metric.name, instrument);
            instrument.record(metric.value, metric.attributes);
          }
        } catch {}
      },
      async shutdown() {
        try {
          await provider.forceFlush();
          await provider.shutdown();
        } catch {}
      },
    };
  } catch {
    return undefined;
  }
};

const consentLines = (): Line[] => [
  [{ text: "Help improve glrs?", tone: "accent", bold: true }],
  [{ text: "Send anonymous model performance and cache metrics. Never prompts, paths, or keys." }],
  [{ text: "  Y allow   N decline", tone: "muted" }],
];

export const createTelemetryExtension = (
  options: {
    env?: NodeJS.ProcessEnv;
    configPath?: string;
    sink?: () => MetricSink | undefined;
  } = {},
) => {
  let activeSink: MetricSink | undefined;
  return async (g: Glrs): Promise<void> => {
    await activeSink?.shutdown();
    activeSink = undefined;
    const env = options.env ?? process.env;
    if (g.mode === "cli" || telemetrySuppressed(env)) return;
    const configPath = options.configPath ?? telemetryConfigPath();
    let consent = await readTelemetryConsent(configPath);
    let sink = consent === true ? (options.sink ?? (() => createOtelSink(env)))() : undefined;
    activeSink = sink;
    let consentWrite: Promise<void> | undefined;
    let asked = false;

    g.on("usage", (usage) => {
      if (consent === true) for (const metric of measurementsFor(usage)) sink?.record(metric);
      return undefined;
    });
    g.on("session_end", async () => {
      await consentWrite;
      await sink?.shutdown();
      if (activeSink === sink) activeSink = undefined;
      return undefined;
    });

    if (consent !== undefined || !g.hasUI) return;
    g.on("session_start", () => {
      if (asked) return;
      asked = true;
      let handle: { close: () => void } | undefined;
      handle = g.ui.capture({
        render: consentLines,
        onKey: ({ key }) => {
          if (key !== "y" && key !== "n" && key !== "escape") return;
          handle?.close();
          const enabled = key === "y";
          consent = enabled;
          consentWrite = writeTelemetryConsent(enabled, configPath).then((written) => {
            if (!written) {
              consent = false;
              g.print("Could not save the telemetry choice; telemetry remains off.", "warning");
              return;
            }
            if (enabled) {
              sink = (options.sink ?? (() => createOtelSink(env)))();
              activeSink = sink;
            }
          });
        },
      });
      return undefined;
    });
  };
};

export default createTelemetryExtension();
