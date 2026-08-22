import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Capture, EventName, EventPayload, Glrs, Handler, Key } from "../../../glrs-core/src";
import {
  createTelemetryExtension,
  type MetricSink,
  measurementsFor,
  otlpEndpoint,
  otlpHeaders,
  readTelemetryConsent,
  telemetryConfigPath,
  telemetrySuppressed,
  writeTelemetryConsent,
} from ".";

const usage = (over: Partial<EventPayload["usage"]> = {}): EventPayload["usage"] => ({
  input: 1_000,
  output: 100,
  cached: 0,
  cacheRead: 0,
  cacheWrite: undefined,
  cacheTelemetry: "read",
  cacheStrategy: "routing-key",
  provider: "azure",
  model: "private-deployment",
  endpoint: "azure-responses",
  durationMs: 250,
  reusablePrefix: true,
  contextTokens: 1_000,
  ...over,
});

describe("telemetry policy", () => {
  test("common do-not-track switches always suppress telemetry", () => {
    expect(telemetrySuppressed({ DO_NOT_TRACK: "1" })).toBe(true);
    expect(telemetrySuppressed({ DNT: "true" })).toBe(true);
    expect(telemetrySuppressed({ OTEL_SDK_DISABLED: "true" })).toBe(true);
    expect(telemetrySuppressed({ OTEL_METRICS_EXPORTER: "none" })).toBe(true);
    expect(telemetrySuppressed({ DO_NOT_TRACK: "0" })).toBe(false);
  });

  test("resolves the user consent file across supported config roots", () => {
    expect(telemetryConfigPath("/home/me", { XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(
      "/xdg/glrs/config.json",
    );
    expect(telemetryConfigPath("C:\\Users\\me", { APPDATA: "C:\\Roaming" }, "win32")).toBe(
      "C:\\Roaming\\glrs\\config.json",
    );
  });

  test("uses standard OTLP endpoint and header variables", () => {
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example/" })).toBe(
      "https://otel.example/v1/metrics",
    );
    expect(
      otlpEndpoint({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://metrics.example/write" }),
    ).toBe("https://metrics.example/write");
    expect(otlpHeaders("Authorization=Bearer%20token,x-tenant=glrs")).toEqual({
      Authorization: "Bearer token",
      "x-tenant": "glrs",
    });
  });

  test("consent is stored in user config without replacing other settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-telemetry-"));
    const path = join(dir, "config.json");
    await writeFile(path, '{"model":"openai/gpt-5"}');
    expect(await readTelemetryConsent(path)).toBeUndefined();
    expect(await writeTelemetryConsent(true, path)).toBe(true);
    expect(await readTelemetryConsent(path)).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      model: "openai/gpt-5",
      telemetry: { enabled: true },
    });
    await rm(dir, { recursive: true, force: true });
  });
});

describe("cache metrics", () => {
  test("distinguishes a hit, miss, ineligible call, and missing telemetry", () => {
    const result = (event: EventPayload["usage"]): unknown =>
      measurementsFor(event)[0]?.attributes["glrs.cache.result"];
    expect(result(usage({ cacheRead: 50 }))).toBe("hit");
    expect(result(usage({ cacheRead: 0 }))).toBe("miss");
    expect(result(usage({ reusablePrefix: false }))).toBe("ineligible");
    expect(result(usage({ cacheRead: undefined }))).toBe("unreported");
  });

  test("exports only bounded metadata and available token measurements", () => {
    const metrics = measurementsFor(usage({ cacheRead: undefined, cacheWrite: undefined }));
    expect(metrics.map(({ name }) => name)).toEqual([
      "glrs.model.requests",
      "gen_ai.client.token.usage",
      "gen_ai.client.token.usage",
      "gen_ai.client.operation.duration",
    ]);
    const encoded = JSON.stringify(metrics);
    expect(encoded).not.toContain("private-deployment");
    expect(encoded).not.toContain("cache this stable prefix");
  });
});

type CaptureHandle = { close: () => void; repaint: () => void };

const extensionHarness = async (configPath: string, modelSelected = true) => {
  const handlers = new Map<EventName, Handler<EventName>>();
  let capture: Capture | undefined;
  let closed = false;
  const recorded: ReturnType<typeof measurementsFor> = [];
  const sink: MetricSink = {
    record: (metric) => recorded.push(metric),
    shutdown: async () => {},
  };
  const g = {
    hasUI: true,
    model: () =>
      modelSelected
        ? { label: "azure/test", provider: "azure", modelId: "test", missing: [] }
        : null,
    on: (name: EventName, handler: Handler<EventName>) => handlers.set(name, handler),
    print: () => {},
    ui: {
      capture: (spec: Capture): CaptureHandle => {
        capture = spec;
        return {
          close: () => {
            closed = true;
          },
          repaint: () => {},
        };
      },
    },
  } as unknown as Glrs;
  await createTelemetryExtension({ env: {}, configPath, sink: () => sink })(g);
  await handlers.get("session_start")?.({ root: "/tmp" });
  return {
    press: (key: string) => capture?.onKey({ key, text: key, ctrl: false, shift: false } as Key),
    screen: () =>
      capture
        ?.render(80)
        .flatMap((line) => line.map((span) => span.text))
        .join("\n") ?? "",
    closed: () => closed,
    recorded,
    usage: async (event: EventPayload["usage"]) => handlers.get("usage")?.(event),
    modelSelect: async () => handlers.get("model_select")?.({ model: "azure/test" }),
  };
};

describe("first-run consent", () => {
  test("asks once, masks no data, and starts only after yes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-telemetry-consent-"));
    const path = join(dir, "config.json");
    const harness = await extensionHarness(path);
    expect(harness.screen()).toContain("Help improve glrs?");
    harness.press("y");
    await Bun.sleep(20);
    expect(harness.closed()).toBe(true);
    expect(await readTelemetryConsent(path)).toBe(true);
    await harness.usage(usage({ cacheRead: 800 }));
    expect(
      harness.recorded.some(
        ({ name, attributes }) =>
          name === "glrs.gen_ai.client.cache.tokens" && attributes["glrs.cache.type"] === "read",
      ),
    ).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("reloading shuts down the previous exporter instead of duplicating it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-telemetry-reload-"));
    const path = join(dir, "config.json");
    await writeTelemetryConsent(true, path);
    let shutdowns = 0;
    const extension = createTelemetryExtension({
      env: {},
      configPath: path,
      sink: () => ({
        record: () => {},
        shutdown: async () => {
          shutdowns += 1;
        },
      }),
    });
    const g = { hasUI: false, on: () => {} } as unknown as Glrs;
    await extension(g);
    await extension(g);
    expect(shutdowns).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  test("waits for model selection when the model picker owns first startup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-telemetry-after-model-"));
    const harness = await extensionHarness(join(dir, "config.json"), false);
    expect(harness.screen()).toBe("");
    await harness.modelSelect();
    expect(harness.screen()).toContain("Help improve glrs?");
    await rm(dir, { recursive: true, force: true });
  });

  test("headless mode neither asks nor enables without existing consent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-telemetry-headless-"));
    let captured = false;
    const g = {
      hasUI: false,
      mode: "print",
      model: () => null,
      on: () => {},
      ui: {
        capture: () => {
          captured = true;
        },
      },
    } as unknown as Glrs;
    await createTelemetryExtension({ env: {}, configPath: join(dir, "config.json") })(g);
    expect(captured).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
