import type { Glrs, Line, ModelInfo, ProviderInfo } from "../../../glrs-core/src";

const PAGE_SIZE = 9;
const LEGACY_AZURE_DEEPSEEK_PROVIDER = "azure-deepseek";
const AZURE_DEEPSEEK_VARIANTS = ["low", "medium", "high", "xhigh", "max"];
const STANDARD_VARIANTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const AZURE_DEEPSEEK_MODELS = ["DeepSeek-V4-Flash", "deepseek-v4-pro"];
const CLOUD_PROVIDERS = new Set(["amazon-bedrock", "google-vertex"]);

type Stage = "model" | "variant" | "provider" | "key" | "resource" | "project";
type State = {
  stage: Stage;
  query: string;
  choice: number;
  model: ModelInfo | null;
  variantChoice: number;
  providers: readonly ProviderInfo[];
  providerChoice: number;
  adding: ProviderInfo | null;
  secret: string;
  resourceName: string;
  project: string;
  notice: string;
};

type CaptureHandle = { close: () => void; repaint: () => void };

const matches = (model: ModelInfo, query: string): boolean => {
  const words = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const haystack = `${model.label} ${model.provider} ${model.modelId}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

const isAzureDeepSeek = (model: ModelInfo): boolean =>
  model.provider === "azure" && model.modelId.toLowerCase().includes("deepseek");

const variantsFor = (model: ModelInfo): readonly string[] =>
  isAzureDeepSeek(model)
    ? AZURE_DEEPSEEK_VARIANTS
    : (model.variants ?? []).filter((variant) => STANDARD_VARIANTS.has(variant));

// Compatibility for configurations written by the short-lived
// `azure-deepseek/*` provider. New picker entries use the built-in Azure
// DeepSeek adapter and do not need request patching.
export const patchReasoningBody = (body: unknown, variant: string | undefined): unknown => {
  if (variant === undefined) return body;
  if (typeof body === "string") {
    try {
      return JSON.stringify(patchReasoningBody(JSON.parse(body), variant));
    } catch {
      return body;
    }
  }
  if (body instanceof Uint8Array)
    return new TextEncoder().encode(
      patchReasoningBody(new TextDecoder().decode(body), variant) as string,
    );
  if (body && typeof body === "object" && !Array.isArray(body))
    return { ...body, reasoning_effort: variant };
  return body;
};

const keyText = (key: { key: string; text: string }): string =>
  key.text !== "" && !/\p{Cc}/u.test(key.text) ? key.text : "";

export default function modelPicker(g: Glrs): void {
  g.on("before_provider_request", ({ body }) => {
    const model = g.model();
    if (model?.provider !== LEGACY_AZURE_DEEPSEEK_PROVIDER) return;
    const apiKey =
      process.env.AZURE_FOUNDRY_API_KEY ??
      process.env.AZURE_OPENAI_API_KEY ??
      process.env.AZURE_API_KEY;
    const headers: Record<string, string> = apiKey ? { "api-key": apiKey } : {};
    return { headers, body: patchReasoningBody(body, model.variant) };
  });

  const open = async (args: string): Promise<void> => {
    if (!g.hasUI) {
      g.print("The model picker requires the TUI.", "warning");
      return;
    }

    let providers = await g.providers();
    const catalogue = await g.models();
    const azureReady = providers.some((provider) => provider.id === "azure" && provider.configured);
    let models = [
      ...catalogue,
      ...(azureReady
        ? AZURE_DEEPSEEK_MODELS.map((modelId) => ({
            label: `azure/${modelId}`,
            provider: "azure",
            modelId,
            variants: AZURE_DEEPSEEK_VARIANTS,
            missing: [],
          }))
        : []),
    ]
      .filter((model, index, all) => all.findIndex((item) => item.label === model.label) === index)
      .sort((left, right) => left.label.localeCompare(right.label));
    const current = g.model();
    if (
      current !== null &&
      providers.some((provider) => provider.id === current.provider && provider.configured) &&
      !models.some((model) => model.label === current.label)
    )
      models.unshift(current);
    const state: State = {
      stage: "model",
      query: args.trim(),
      choice: 0,
      model: null,
      variantChoice: 0,
      providers,
      providerChoice: 0,
      adding: null,
      secret: "",
      resourceName: "",
      project: "",
      notice: "",
    };
    let held: CaptureHandle | null = null;

    const filtered = (): ModelInfo[] => models.filter((model) => matches(model, state.query));
    const selectedModel = (): ModelInfo | undefined => filtered()[state.choice];
    const variants = (): readonly string[] => [
      "default",
      ...(state.model === null ? [] : variantsFor(state.model)),
    ];
    const currentIndex = filtered().findIndex((model) => model.label === current?.label);
    state.choice = Math.max(0, currentIndex);

    const close = (): void => held?.close();
    const choose = async (model: ModelInfo, variant: string): Promise<void> => {
      close();
      try {
        await g.setModel(model.label, variant === "default" ? undefined : variant);
        g.print(
          `Model switched to ${model.label}${variant === "default" ? "" : ` (${variant})`}.`,
          "success",
        );
        const wrote = await g.rememberModel();
        if (wrote === "not-allowed")
          g.print(
            `This session only. To keep it, add "model": "${model.label}" to .glrs/config.json, ` +
              'or "agentConfigAllowlist": ["model"] and glrs will write it for you.',
            "muted",
          );
        if (wrote === "failed") g.print("Could not write .glrs/config.json.", "warning");
      } catch (error) {
        g.print(
          `Could not switch model: ${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      }
    };

    const refresh = async (provider: ProviderInfo): Promise<void> => {
      providers = await g.providers();
      models = [...(await g.models())];
      if (provider.id === "azure")
        models.push(
          ...AZURE_DEEPSEEK_MODELS.map((modelId) => ({
            label: `azure/${modelId}`,
            provider: "azure",
            modelId,
            variants: AZURE_DEEPSEEK_VARIANTS,
            missing: [],
          })),
        );
      models = models
        .filter(
          (model, index, all) => all.findIndex((item) => item.label === model.label) === index,
        )
        .sort((left, right) => left.label.localeCompare(right.label));
      state.query = `${provider.id}/`;
      state.choice = 0;
      state.stage = "model";
      state.notice = `${provider.label} connected.`;
      held?.repaint();
    };

    const connect = async (): Promise<void> => {
      const provider = state.adding;
      if (!provider || (provider.missing?.includes("credential") && state.secret.trim() === ""))
        return;
      state.notice = "Saving in the operating-system credential store…";
      held?.repaint();
      const settings = {
        ...(provider.id === "azure" && state.resourceName.trim() !== ""
          ? { resourceName: state.resourceName.trim() }
          : {}),
        ...(provider.id === "google-vertex" && state.project.trim() !== ""
          ? { project: state.project.trim() }
          : {}),
      };
      const result = await g.connectProvider(
        provider.id,
        state.secret.trim() || undefined,
        Object.keys(settings).length === 0 ? undefined : settings,
      );
      state.secret = "";
      if (!result.ok) {
        state.notice = result.message;
        held?.repaint();
        return;
      }
      await refresh(provider);
    };

    const drawModels = (columns: number): Line[] => {
      const found = filtered();
      const room = Math.max(20, columns - 4);
      const maxStart = Math.max(0, found.length - PAGE_SIZE);
      const start = Math.min(maxStart, Math.max(0, state.choice - Math.floor(PAGE_SIZE / 2)));
      const visible = found.slice(start, start + PAGE_SIZE);
      const lines: Line[] = [
        [
          { text: "? ", tone: "accent", bold: true },
          { text: "Choose model", bold: true },
          { text: `  ${found.length}/${models.length}`, tone: "muted" },
        ],
        [
          { text: "  search: ", tone: "muted" },
          { text: g.clip(state.query, Math.max(1, room - 10)) },
          { text: "▏", tone: "accent" },
        ],
      ];
      if (visible.length === 0)
        lines.push([{ text: "    No matching models. Ctrl+A adds a provider", tone: "warning" }]);
      else
        for (const [offset, model] of visible.entries()) {
          const index = start + offset;
          const picked = index === state.choice;
          const isCurrent = model.label === current?.label;
          const suffix = isCurrent ? "  current" : "";
          lines.push([
            { text: picked ? "  › " : "    ", tone: "accent" },
            {
              text: g.clip(model.label, Math.max(1, room - suffix.length)),
              tone: picked ? "accent" : "highlight",
              bold: picked,
            },
            ...(suffix === "" ? [] : [{ text: suffix, tone: "muted" as const }]),
          ]);
        }
      if (state.notice) lines.push([{ text: `  ${state.notice}`, tone: "success" }]);
      lines.push([
        {
          text: "  Type to filter · ↑↓ move · Enter choose · Ctrl+A add · Esc cancel",
          tone: "muted",
        },
      ]);
      return lines;
    };

    const drawVariants = (columns: number): Line[] => {
      const choices = variants();
      const room = Math.max(20, columns - 4);
      const label = state.model?.label ?? "model";
      return [
        [{ text: `? Reasoning for ${g.clip(label, room)}`, tone: "accent", bold: true }],
        ...choices.map((variant, index) => [
          { text: index === state.variantChoice ? "  › " : "    ", tone: "accent" as const },
          {
            text: variant,
            tone: index === state.variantChoice ? ("accent" as const) : ("highlight" as const),
            bold: index === state.variantChoice,
          },
        ]),
        [{ text: "  ↑↓ move · Enter choose · Esc back", tone: "muted" }],
      ];
    };

    const drawProviders = (): Line[] => [
      [{ text: "? Add provider", tone: "accent", bold: true }],
      ...providers.map((provider, index) => [
        { text: index === state.providerChoice ? "  › " : "    ", tone: "accent" as const },
        {
          text: provider.label,
          tone: index === state.providerChoice ? ("accent" as const) : ("highlight" as const),
          bold: index === state.providerChoice,
        },
        { text: provider.configured ? `  ✓ ${provider.source}` : "", tone: "muted" as const },
      ]),
      ...(state.notice ? [[{ text: `  ${state.notice}`, tone: "warning" as const }]] : []),
      [{ text: "  ↑↓ move · Enter configure · Esc back", tone: "muted" }],
    ];

    const drawInput = (label: string, value: string, secret: boolean): Line[] => [
      [{ text: `? ${label}`, tone: "accent", bold: true }],
      [{ text: `  ${secret ? "•".repeat(value.length) : value}▏` }],
      ...(state.notice ? [[{ text: `  ${state.notice}`, tone: "warning" as const }]] : []),
      [{ text: "  Enter save · Esc back", tone: "muted" }],
    ];

    const draw = (columns: number): Line[] => {
      if (state.stage === "model") return drawModels(columns);
      if (state.stage === "variant") return drawVariants(columns);
      if (state.stage === "provider") return drawProviders();
      if (state.stage === "resource")
        return drawInput("Azure resource name", state.resourceName, false);
      if (state.stage === "project") return drawInput("Google Cloud project", state.project, false);
      return drawInput(`${state.adding?.label ?? "Provider"} API key`, state.secret, true);
    };

    const onKey = (key: { key: string; text: string; ctrl: boolean }): void => {
      if (state.stage === "variant") {
        const choices = variants();
        if (key.key === "escape") state.stage = "model";
        else if (key.key === "up")
          state.variantChoice = (state.variantChoice + choices.length - 1) % choices.length;
        else if (key.key === "down")
          state.variantChoice = (state.variantChoice + 1) % choices.length;
        else if (key.key === "return") {
          const variant = choices[state.variantChoice];
          if (state.model && variant) void choose(state.model, variant);
        }
        return;
      }

      if (state.stage === "provider") {
        if (key.key === "escape") state.stage = "model";
        else if (key.key === "up" && providers.length > 0)
          state.providerChoice = (state.providerChoice + providers.length - 1) % providers.length;
        else if (key.key === "down" && providers.length > 0)
          state.providerChoice = (state.providerChoice + 1) % providers.length;
        else if (key.key === "return") {
          const provider = providers[state.providerChoice];
          if (!provider) return;
          if (provider.configured) {
            state.query = `${provider.id}/`;
            state.choice = 0;
            state.stage = "model";
          } else if (
            provider.id === "google-vertex" &&
            !provider.missing?.includes("credential") &&
            provider.missing?.includes("project")
          ) {
            state.adding = provider;
            state.project = "";
            state.notice = "";
            state.stage = "project";
          } else if (CLOUD_PROVIDERS.has(provider.id)) {
            state.notice = provider.note ?? `Configure ${provider.env.join(" or ")} and try again.`;
          } else if (
            provider.id === "azure" &&
            !provider.missing?.includes("credential") &&
            provider.missing?.includes("resource")
          ) {
            state.adding = provider;
            state.resourceName = "";
            state.notice = "";
            state.stage = "resource";
          } else {
            state.adding = provider;
            state.secret = "";
            state.notice = "";
            state.stage = "key";
          }
        }
        return;
      }

      if (state.stage === "key" || state.stage === "resource" || state.stage === "project") {
        if (key.key === "escape") {
          state.stage = "provider";
          state.secret = "";
          state.notice = "";
          return;
        }
        const field =
          state.stage === "key"
            ? "secret"
            : state.stage === "resource"
              ? "resourceName"
              : "project";
        if (key.key === "backspace") state[field] = state[field].slice(0, -1);
        else if (key.key === "return") {
          if (
            state.stage === "key" &&
            state.adding?.id === "azure" &&
            state.adding.missing?.includes("resource") &&
            state.resourceName.trim() === ""
          )
            state.stage = "resource";
          else void connect();
        } else state[field] += keyText(key);
        return;
      }

      const found = filtered();
      if (key.ctrl && key.key === "a") {
        state.stage = "provider";
        state.notice = "";
      } else if (key.key === "escape") close();
      else if (key.key === "up" && found.length > 0)
        state.choice = (state.choice + found.length - 1) % found.length;
      else if (key.key === "down" && found.length > 0)
        state.choice = (state.choice + 1) % found.length;
      else if (key.key === "backspace") {
        state.query = state.query.slice(0, -1);
        state.choice = 0;
      } else if (key.key === "return") {
        const model = selectedModel();
        if (!model) return;
        if (variantsFor(model).length === 0) void choose(model, "default");
        else {
          state.model = model;
          state.stage = "variant";
          state.variantChoice = Math.max(0, variants().indexOf(current?.variant ?? "default"));
        }
      } else if (keyText(key) !== "") {
        state.query += keyText(key);
        state.choice = 0;
      }
    };

    held = g.ui.capture({ render: draw, onKey });
  };

  g.command("model", {
    description: "Choose the model and reasoning effort for the next turn",
    run: open,
  });
  g.on("session_start", async () => {
    if (g.model() === null) await open("");
    return undefined;
  });
}
