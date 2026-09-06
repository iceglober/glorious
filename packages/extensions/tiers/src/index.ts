import type { Glrs, ModelInfo } from "../../../glrs-core/src";

// A tier is a name for "the model I want for this kind of work", and a list of
// candidates in the order you would rather have them. The first one glrs has
// credentials for wins.
//
// glrs ships no tiers and no opinion about which model is which. A table saying
// `medium = opus-5` is wrong the month a new model lands, and it is exactly the
// kind of default this project does not invent. Your config names them:
//
//   {
//     "extensions": {
//       "load": ["tiers"],
//       "settings": {
//         "tiers": {
//           "default": "balanced",
//           "fast": ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-mini"],
//           "balanced": ["anthropic/claude-opus-5", "azure/gpt-5.6-sol"],
//           "deep": [{ "model": "anthropic/claude-opus-5", "variant": "high" }]
//         }
//       }
//     }
//   }
//
// `default` is the tier used when a session opens with no model configured. It
// resolves before the picker opens, so the ordinary path is that you never see
// the picker at all.

type Candidate = { model: string; variant?: string };

type Settings = {
  default?: string;
  [tier: string]: string | readonly (string | Candidate)[] | undefined;
};

const RESERVED = "default";

// One candidate, however it was written. A bare string is the common case and a
// `variant` is the reason the object form exists: the same model at a different
// reasoning effort is a different tier, not a different model.
const candidate = (one: unknown): Candidate | null => {
  if (typeof one === "string" && one.includes("/")) return { model: one };
  if (typeof one !== "object" || one === null) return null;
  const { model, variant } = one as { model?: unknown; variant?: unknown };
  if (typeof model !== "string" || !model.includes("/")) return null;
  return { model, ...(typeof variant === "string" ? { variant } : {}) };
};

export const tiersFrom = (
  settings: unknown,
): { tiers: Map<string, Candidate[]>; fallback: string | null } => {
  const tiers = new Map<string, Candidate[]>();
  if (typeof settings !== "object" || settings === null) return { tiers, fallback: null };
  const raw = settings as Settings;
  for (const [name, value] of Object.entries(raw)) {
    if (name === RESERVED) continue;
    // A lone string is a tier of one, which is what most tiers are.
    const list = (Array.isArray(value) ? value : [value])
      .map(candidate)
      .filter((one): one is Candidate => one !== null);
    if (list.length > 0) tiers.set(name, list);
  }
  const fallback = typeof raw.default === "string" ? raw.default : null;
  return { tiers, fallback };
};

// What glrs could not find for a provider, from whatever the catalogue knows
// about it. A model the catalogue has never heard of, which is every custom
// deployment, is judged by its provider rather than written off.
const gapsBy = (models: readonly ModelInfo[]): ((label: string) => readonly string[]) => {
  const byProvider = new Map<string, readonly string[]>();
  for (const model of models)
    if (!byProvider.has(model.provider)) byProvider.set(model.provider, model.missing ?? []);
  return (label) => byProvider.get(label.split("/")[0] ?? "") ?? [];
};

/** The first candidate whose provider glrs has credentials for. */
export const resolve = (
  list: readonly Candidate[],
  gaps: (label: string) => readonly string[],
): Candidate | null => list.find((one) => gaps(one.model).length === 0) ?? null;

export default function tiers(g: Glrs): void {
  const read = (): { tiers: Map<string, Candidate[]>; fallback: string | null } =>
    tiersFrom(g.config());

  const gaps = async (): Promise<(label: string) => readonly string[]> =>
    gapsBy(await g.models().catch(() => []));

  const apply = async (name: string): Promise<boolean> => {
    const { tiers: table } = read();
    const list = table.get(name);
    if (list === undefined) return false;
    const picked = resolve(list, await gaps());
    if (picked === null) {
      g.print(
        `no model in tier "${name}" has credentials glrs can see: ${list
          .map((one) => one.model)
          .join(", ")}`,
        "warning",
      );
      return false;
    }
    await g.setModel(picked.model, picked.variant);
    g.print(`${name}: ${picked.model}${picked.variant ? ` (${picked.variant})` : ""}`, "success");
    return true;
  };

  const listing = async (): Promise<string> => {
    const { tiers: table, fallback } = read();
    if (table.size === 0)
      return "No tiers configured. Add extensions.settings.tiers to your glrs config, keyed by whatever you want to call them.";
    const gap = await gaps();
    const active = g.model()?.label;
    return [...table.entries()]
      .map(([name, list]) => {
        const picked = resolve(list, gap);
        const mark = picked !== null && picked.model === active ? "› " : "  ";
        const said =
          picked === null
            ? "nothing reachable"
            : `${picked.model}${picked.variant ? ` (${picked.variant})` : ""}`;
        return `${mark}${name}${name === fallback ? " (default)" : ""}  ${said}`;
      })
      .join("\n");
  };

  g.command("tier", {
    description: "Switch to a configured tier of model",
    run: async (args) => {
      const name = args.trim();
      if (name === "") return g.print(await listing());
      if (!(await apply(name))) {
        const { tiers: table } = read();
        if (!table.has(name))
          g.print(
            `no tier called "${name}". ${[...table.keys()].join(", ") || "none configured"}`,
            "warning",
          );
      }
    },
  });

  // A session that opened with no model gets one from the default tier, before
  // anything else offers to fill the hole. Loaded ahead of model-picker in the
  // roster for exactly this: if the tier resolves, the picker sees a model and
  // stays shut.
  g.on("session_start", async () => {
    if (g.model() !== null) return undefined;
    const { fallback } = read();
    if (fallback !== null) await apply(fallback);
    return undefined;
  });
}
