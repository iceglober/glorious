import type { Glrs, Line, ModelInfo } from "../../../glrs-core/src";

const PAGE_SIZE = 9;
const AZURE_DEEPSEEK_PROVIDER = "azure-deepseek";
const AZURE_DEEPSEEK_VARIANTS = ["low", "medium", "high", "xhigh", "max"];
const STANDARD_VARIANTS = new Set(["minimal", "low", "medium", "high"]);
const AZURE_DEEPSEEK_MODELS = ["DeepSeek-V4-Flash", "deepseek-v4-pro"];

type State = {
  stage: "model" | "variant";
  query: string;
  choice: number;
  model: ModelInfo | null;
  variantChoice: number;
};

type CaptureHandle = { close: () => void; repaint: () => void };

const matches = (model: ModelInfo, query: string): boolean => {
  const words = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const haystack = `${model.label} ${model.provider} ${model.modelId}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

const variantsFor = (model: ModelInfo): readonly string[] =>
  model.provider === AZURE_DEEPSEEK_PROVIDER
    ? AZURE_DEEPSEEK_VARIANTS
    : (model.variants ?? []).filter((variant) => STANDARD_VARIANTS.has(variant));

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

export default function modelPicker(g: Glrs): void {
  // Azure Foundry's OpenAI-compatible endpoint needs its API key under this
  // header, and DeepSeek accepts reasoning effort in the request body. Keeping
  // this beside the two explicit catalogue additions makes the custom provider
  // work exactly like the standard models in the picker.
  g.on("before_provider_request", ({ body }) => {
    const model = g.model();
    if (model.provider !== AZURE_DEEPSEEK_PROVIDER) return;
    const apiKey =
      process.env.AZURE_FOUNDRY_API_KEY ??
      process.env.AZURE_OPENAI_API_KEY ??
      process.env.AZURE_API_KEY;
    const headers: Record<string, string> = apiKey ? { "api-key": apiKey } : {};
    return {
      headers,
      body: patchReasoningBody(body, model.variant),
    };
  });

  g.command("model", {
    description: "Choose the model and reasoning effort for the next turn",
    run: async (args) => {
      if (!g.hasUI) {
        g.print("The model picker requires the TUI.", "warning");
        return;
      }

      const catalogue = await g.models();
      const additions: ModelInfo[] = AZURE_DEEPSEEK_MODELS.map((modelId) => ({
        label: `${AZURE_DEEPSEEK_PROVIDER}/${modelId}`,
        provider: AZURE_DEEPSEEK_PROVIDER,
        modelId,
        variants: AZURE_DEEPSEEK_VARIANTS,
      }));
      const models = [...catalogue, ...additions]
        .filter(
          (model, index, all) => all.findIndex((item) => item.label === model.label) === index,
        )
        .sort((left, right) => left.label.localeCompare(right.label));
      const current = g.model();
      const state: State = {
        stage: "model",
        query: args.trim(),
        choice: 0,
        model: null,
        variantChoice: 0,
      };
      let held: CaptureHandle | null = null;

      const filtered = (): ModelInfo[] => models.filter((model) => matches(model, state.query));
      const selectedModel = (): ModelInfo | undefined => filtered()[state.choice];
      const variants = (): readonly string[] => [
        "default",
        ...(state.model === null ? [] : variantsFor(state.model)),
      ];
      const currentIndex = filtered().findIndex((model) => model.label === current.label);
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
        } catch (error) {
          g.print(
            `Could not switch model: ${error instanceof Error ? error.message : String(error)}`,
            "danger",
          );
        }
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

        if (visible.length === 0) {
          lines.push([{ text: "    No matching models", tone: "warning" }]);
        } else {
          for (const [offset, model] of visible.entries()) {
            const index = start + offset;
            const picked = index === state.choice;
            const isCurrent = model.label === current.label;
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
        }
        lines.push([
          { text: "  Type to filter · ↑↓ move · Enter choose · Esc cancel", tone: "muted" },
        ]);
        return lines;
      };

      const drawVariants = (columns: number): Line[] => {
        const choices = variants();
        const room = Math.max(20, columns - 4);
        const label = state.model?.label ?? "model";
        const lines: Line[] = [
          [
            { text: "? ", tone: "accent", bold: true },
            { text: g.clip(`Reasoning for ${label}`, room), bold: true },
          ],
        ];
        for (const [index, variant] of choices.entries()) {
          const picked = index === state.variantChoice;
          lines.push([
            { text: picked ? "  › " : "    ", tone: "accent" },
            {
              text: variant,
              tone: picked ? "accent" : "highlight",
              bold: picked,
            },
          ]);
        }
        lines.push([{ text: "  ↑↓ move · Enter choose · Esc back", tone: "muted" }]);
        return lines;
      };

      const onKey = (key: { key: string; text: string }): void => {
        if (state.stage === "variant") {
          const choices = variants();
          if (key.key === "escape") {
            state.stage = "model";
            return;
          }
          if (key.key === "up")
            state.variantChoice = (state.variantChoice + choices.length - 1) % choices.length;
          else if (key.key === "down")
            state.variantChoice = (state.variantChoice + 1) % choices.length;
          else if (key.key === "return") {
            const variant = choices[state.variantChoice];
            if (state.model && variant) void choose(state.model, variant);
          }
          return;
        }

        const found = filtered();
        if (key.key === "escape") {
          close();
          return;
        }
        if (key.key === "up" && found.length > 0)
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
            state.variantChoice = Math.max(0, variants().indexOf(current.variant ?? "default"));
          }
        } else if (key.text !== "" && !/\p{Cc}/u.test(key.text)) {
          state.query += key.text;
          state.choice = 0;
        }
      };

      held = g.ui.capture({
        render: (columns) =>
          state.stage === "model" ? drawModels(columns) : drawVariants(columns),
        onKey,
      });
    },
  });
}
