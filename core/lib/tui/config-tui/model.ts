import type { PermissionDecision } from "../../agent/permissions";
import type { ConfigLayer, WritableConfigLayer } from "../../config";
import { windowList } from "../list-window";

/**
 * Pure state machine for the interactive config TUI. No terminal, no I/O: it
 * takes a snapshot of the current config, tracks navigation and overlay state,
 * renders a view model, and — on edits — returns effects the host applies
 * through the config handlers, then reloads a fresh snapshot. The OpenTUI
 * renderer and the headless tests drive the exact same model.
 */

/** One role's resolved model: the full `provider/model` ref, split, + variant. */
export interface RoleModel {
  ref: string;
  provider: string;
  model: string;
  variant: string;
  layer?: ConfigLayer;
}

/** What the picker needs to set up a keyless (cloud-auth) provider. Mirrors the
 *  llm module's CloudAuthStatus, kept local so the pure model has no llm import. */
export interface CloudAuthInfo {
  credsPresent: boolean;
  cliAvailable: boolean;
  loginArgv: string[];
  params: Array<{ key: string; label: string; placeholder: string; value: string }>;
}

export interface ConfigTuiData {
  /** Named model roles (compiled to the tier ladder by the host on apply). Each
   *  role's `ref` is the display `provider/model`, with the parts split out. */
  models: {
    plan: RoleModel;
    build: RoleModel;
  };
  /** The picker's provider column (column 0): only connected providers, plus the
   *  current role's provider. Connect others via the catalog (^n). */
  modelProviders: string[];
  /** Suggested model ids per provider — column 2 (the picker also takes free text). */
  providerModels: Record<string, string[]>;
  /** Which model ids support a reasoning-effort variant (column 3), per provider. */
  reasoningModels: Record<string, string[]>;
  /** Variants offered per model — column 3 (what the model accepts). */
  availableVariants: string[];
  /** Every provider with its connection status; keyless = cloud credential
   *  chain (whose `connected` reflects whether those creds are detected). */
  providers: Array<{ name: string; connected: boolean; keyless: boolean }>;
  /** Providers offered in the connect picker (the API-key ones). */
  connectableProviders: string[];
  /** Cloud-auth status per keyless provider (creds detected, CLI present, the
   *  login command, and the non-secret params to collect). */
  cloudAuth: Record<string, CloudAuthInfo>;
  trust: {
    uncaged: boolean;
    uncagedLayer?: ConfigLayer;
    rules: Array<{ pattern: string; decision: PermissionDecision; layer?: ConfigLayer }>;
  };
  mcp: Array<{ name: string; transport: string }>;
  /** Display path of each writable layer's file (shown next to the scope). */
  layerPaths: Record<WritableConfigLayer, string>;
}

/** Writable layers the editor can target, in cycle order, with short labels. */
export const SCOPES: readonly WritableConfigLayer[] = ["global", "project", "local"] as const;
export const SCOPE_LABELS: Record<WritableConfigLayer, string> = {
  global: "Global",
  project: "Project",
  local: "ProjectLocal",
};
/** Short provenance tag shown against a value, e.g. "· project". */
const layerNote = (layer: ConfigLayer | undefined): string | undefined =>
  !layer || layer === "default" || layer === "base" ? undefined : layer;

export type ConfigEffect =
  | { kind: "setModel"; role: "plan" | "build"; model: string; variant?: string }
  | { kind: "setRule"; pattern: string; decision: PermissionDecision }
  | { kind: "removeRule"; pattern: string }
  | { kind: "setUncaged"; on: boolean }
  | { kind: "connectProvider"; provider: string; apiKey: string }
  | { kind: "disconnectProvider"; provider: string }
  // A cloud-auth provider's non-secret params (Bedrock region, Vertex project /
  // location) → agent.llm.providers.<provider>. A layered config write.
  | { kind: "setProviderConfig"; provider: string; config: Record<string, string> }
  // Suspend the TUI and run the vendor login CLI (aws sso / gcloud …), then
  // resume. Imperative — the screen handles it, not the config host.
  | { kind: "runLogin"; provider: string; argv: string[] }
  // Verify a cloud provider's live session before entering its models. Async —
  // the screen validates and reports back via reportSessionCheck.
  | { kind: "checkSession"; provider: string; role: "plan" | "build" }
  | { kind: "addServer"; name: string; transport: "stdio" | "http"; target: string }
  | { kind: "removeServer"; name: string }
  | { kind: "reloadMcp" }
  | { kind: "quit" };

export type UiTone = "accent" | "muted" | "success" | "warning" | "danger";

export interface ConfigViewRow {
  label: string;
  value?: string;
  tone?: UiTone;
  /** Small right-aligned annotation (scope, transport, key status). */
  note?: string;
  cursor: boolean;
  /** Non-focusable header/blank rows are skipped by the cursor. */
  header?: boolean;
  action?: boolean;
  /** Draw a faint separator line above this row (e.g. before the floor). */
  divider?: boolean;
}

/** One column of the Miller-column model picker. */
export interface ConfigOverlayColumn {
  title: string;
  /** The live search string for this column (only the active column shows a caret). */
  search?: string;
  active: boolean;
  items: Array<{ label: string; note?: string; cursor: boolean; muted?: boolean }>;
}

export interface ConfigOverlayView {
  title: string;
  items: Array<{ label: string; note?: string; cursor: boolean }>;
  input?: { prompt: string; value: string; masked?: boolean };
  /** A ←→-cycled value shown by the title (e.g. the model variant), with the
   *  value highlighted as the anchor for that control. */
  control?: { label: string; value: string };
  /** Miller-column layout (the model picker); replaces `items` when present. */
  columns?: ConfigOverlayColumn[];
  keys: Array<[string, string]>;
}

export interface ConfigView {
  title: string;
  sections: Array<{ label: string; active: boolean }>;
  rows: ConfigViewRow[];
  hint?: string;
  keys: Array<[string, string]>;
  overlay?: ConfigOverlayView;
  toast?: string;
  /** Layer edits write to, its human label, and the file it lands in. */
  scope: WritableConfigLayer;
  scopeLabel: string;
  scopePath: string;
}

export interface KeyPress {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  /** The printable character typed, if any (drives text fields in overlays). */
  char?: string;
}

// Providers are no longer a top-level section — you connect/manage them from
// the model picker's catalog (the `n` key), since connecting a provider only
// matters in service of choosing one of its models.
const SECTIONS = ["models", "trust", "mcp"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABELS: Record<Section, string> = {
  models: "Models",
  trust: "Trust",
  mcp: "MCP",
};

const DECISIONS: PermissionDecision[] = ["allow", "ask", "deny"];
const decisionTone = (d: PermissionDecision): UiTone =>
  d === "allow" ? "success" : d === "deny" ? "danger" : "warning";

/** Idiomatic patterns offered when adding a rule (no invented DSL). */
export const RULE_SUGGESTIONS = [
  "bash(*)",
  "bash(git *)",
  "bash(pnpm *)",
  "bash(npm *)",
  "edit",
  "web",
  "mcp_*",
];
/** The add-server form: you type the real name, transport, and command/URL —
 *  no invented catalog. Fields: 0 = name, 1 = transport, 2 = target. */
const SERVER_FIELDS = 3;
type ServerForm = {
  kind: "server-add";
  field: number;
  name: string;
  transport: "stdio" | "http";
  target: string;
};

/** The connect-provider form: pick a provider (field 0), enter its key (field 1). */
const PROVIDER_FIELDS = 2;
type ProviderForm = { kind: "provider-add"; field: number; idx: number; apiKey: string };

/** The cloud-auth setup form for a keyless provider (Bedrock / Vertex): edit the
 *  non-secret params, then run the vendor login CLI or save the params. */
type CloudForm = {
  kind: "cloud-add";
  provider: string;
  field: number;
  values: string[]; // one per param, index-aligned to data.cloudAuth[provider].params
};

/** The Miller-column model picker: column 0 provider, 1 model, 2 variant. Each
 *  column searches with `query`; `idx` is the cursor in the active column. */
type ModelExplorer = {
  kind: "model";
  role: "plan" | "build";
  col: 0 | 1 | 2;
  provider: string;
  model: string;
  variant: string;
  query: string;
  idx: number;
};

/** The "Connect New Provider" catalog, opened with `n` from the picker: the full
 *  provider list with connection status, where you connect / disconnect / set up
 *  cloud auth. `idx` is the cursor; `role` is the picker it returns to on Esc. */
type ProviderCatalog = { kind: "provider-catalog"; role: "plan" | "build"; idx: number };

/** After any change commits, this overlay asks which layer to write it to —
 *  defaulting to Project — so every save's destination is an explicit choice,
 *  never a silent write to a sticky scope. `pending` is the held effect;
 *  Esc discards it (nothing saved). */
type ScopeConfirm = { kind: "scope-confirm"; pending: ConfigEffect; label: string; idx: number };

type Overlay =
  | ModelExplorer
  | { kind: "rule-add"; idx: number; decision: PermissionDecision }
  | ServerForm
  | ProviderForm
  | CloudForm
  | ProviderCatalog
  | ScopeConfirm
  | null;

/** Where a connect/setup form returns when it closes. `picker` resumes the model
 *  picker for that role (advancing to models once the provider is usable);
 *  `catalog` reopens the provider catalog at its cursor. */
type FormReturn =
  | { via: "picker"; role: "plan" | "build"; provider: string }
  | { via: "catalog"; role: "plan" | "build"; idx: number }
  | null;

const filterList = (list: readonly string[], query: string): string[] => {
  const q = query.trim().toLowerCase();
  return q ? list.filter((x) => x.toLowerCase().includes(q)) : [...list];
};

/** One focusable/renderable row plus what editing it does. */
interface Item {
  row: Omit<ConfigViewRow, "cursor">;
  focusable: boolean;
  onLeft?: () => ConfigEffect | null;
  onRight?: () => ConfigEffect | null;
  onEnter?: () => ConfigEffect | null;
  onRemove?: () => ConfigEffect | null;
  hint?: string;
}

/** Result of a live cloud-session check: usable, needs re-auth, or no creds. */
export type SessionCheck = "valid" | "stale" | "missing";

export interface ConfigTuiModel {
  view(): ConfigView;
  /** Handle a key. Returns effects for the host to apply (then call reload). */
  handleKey(key: KeyPress): ConfigEffect[];
  /** Layer the next edit writes to (the host routes effects here). */
  scope(): WritableConfigLayer;
  reload(data: ConfigTuiData): void;
  /** The screen reports a checkSession result back here (async validation). */
  reportSessionCheck(provider: string, result: SessionCheck): void;
  toast(text: string): void;
}

export function createConfigTuiModel(initial: ConfigTuiData): ConfigTuiModel {
  let data = initial;
  let section = 0;
  let row = 0;
  let overlay: Overlay = null;
  let toastText: string | undefined;
  // The layer the most recent save was routed to; seeds the scope-confirm
  // default and is what the host reads via scope() right after a confirm.
  let scope: WritableConfigLayer = "project";
  // Where the open connect/setup form returns when it closes (picker or catalog).
  let formReturn: FormReturn = null;
  // The cloud provider whose live session is being validated right now (shows a
  // "checking…" indicator on its picker cell).
  let checking: string | null = null;

  const modelShort = (id: string): string => id.replace(/^gpt-|^claude-/, "");

  // ---- provider connection status (drives picker glyphs + gating) ----
  const providerOf = (name: string) => data.providers.find((p) => p.name === name);
  const providerConnected = (name: string): boolean => providerOf(name)?.connected ?? false;
  const providerKeyless = (name: string): boolean => providerOf(name)?.keyless ?? false;
  /** Short right-aligned status for a provider cell in the picker. */
  const providerStatusNote = (name: string): string => {
    const p = providerOf(name);
    if (!p) return "";
    if (p.connected) return p.keyless ? "cloud ✓" : "✓";
    return "connect ↵";
  };

  const items = (): Item[] => {
    const sec = SECTIONS[section];
    if (sec === "models") return modelItems();
    if (sec === "trust") return trustItems();
    return mcpItems();
  };

  const modelItems = (): Item[] => {
    const pick = (role: "plan" | "build"): Item => {
      const rm = data.models[role];
      const layer = layerNote(rm.layer);
      return {
        focusable: true,
        row: {
          label: role === "plan" ? "Plan model" : "Build model",
          value: rm.ref,
          // Note carries the effective variant, plus the source layer if pinned.
          note: layer ? `${rm.variant} · ${layer}` : rm.variant,
        },
        hint: `which model ${role === "plan" ? "drafts the plan" : "writes the code"} · ⏎ pick provider / model / variant`,
        onEnter: () => {
          // Open on the provider column; ⏎ advances to model, then variant.
          openModelPicker(role, rm.provider, 0);
          return null;
        },
      };
    };
    return [pick("plan"), pick("build")];
  };

  // ---- model picker (Miller columns) ----
  type Cell = { value: string; label: string; note?: string; custom?: boolean };

  /** Whether a model gets a variant (3rd) column: a catalogued reasoning model,
   *  or a custom id we can't classify (offer it rather than hide it). */
  const modelReasons = (provider: string, model: string): boolean => {
    if (!model) return false;
    const known = data.providerModels[provider] ?? [];
    if (!known.includes(model)) return true; // custom / typed id → offer the column
    return (data.reasoningModels[provider] ?? []).includes(model);
  };
  /** The last column for the current selection: 2 (variant) when the model
   *  reasons, else 1 (model). */
  const lastCol = (o: ModelExplorer): 0 | 1 | 2 => (modelReasons(o.provider, o.model) ? 2 : 1);

  const explorerCells = (o: ModelExplorer): Cell[] => {
    if (o.col === 0)
      return filterList(data.modelProviders, o.query).map((p) => ({
        value: p,
        label: p,
        note: providerStatusNote(p),
      }));
    if (o.col === 2)
      return filterList(data.availableVariants, o.query).map((v) => ({ value: v, label: v }));
    // Column 1: the provider's model suggestions, plus a literal from the query.
    const sugg = filterList(data.providerModels[o.provider] ?? [], o.query);
    const cells: Cell[] = sugg.map((m) => ({ value: m, label: modelShort(m), note: m }));
    const q = o.query.trim();
    if (q && !sugg.includes(q)) cells.push({ value: q, label: `use “${q}”`, custom: true });
    return cells;
  };

  /** Sync the column's selection (provider/model/variant) to the cursor. */
  const explorerApply = (o: ModelExplorer): void => {
    const cell = explorerCells(o)[o.idx];
    if (!cell) {
      if (o.col === 1) o.model = o.query.trim();
      return;
    }
    if (o.col === 0) o.provider = cell.value;
    else if (o.col === 1) o.model = cell.value;
    else o.variant = cell.value;
  };

  /** Point the cursor at the current selection when a column (re)activates. */
  const explorerReset = (o: ModelExplorer): void => {
    const cur = o.col === 0 ? o.provider : o.col === 1 ? o.model : o.variant;
    const cells = explorerCells(o);
    const at = cells.findIndex((c) => c.value === cur);
    o.idx = at >= 0 ? at : 0;
    explorerApply(o);
  };

  // A column's full (unfiltered) cells, for the trail columns behind the cursor.
  const cellsForCol = (o: ModelExplorer, col: 0 | 1 | 2): Cell[] => {
    if (col === 0)
      return data.modelProviders.map((p) => ({ value: p, label: p, note: providerStatusNote(p) }));
    if (col === 1)
      return (data.providerModels[o.provider] ?? []).map((m) => ({
        value: m,
        label: modelShort(m),
        note: m,
      }));
    return data.availableVariants.map((v) => ({ value: v, label: v }));
  };

  const EXPLORER_ROWS = 9;

  const explorerColumns = (o: ModelExplorer): ConfigOverlayColumn[] => {
    // The variant column exists only when the selected model reasons; while on
    // the provider column (no model chosen yet) show it as a pending column.
    const showVariant = o.col === 0 || modelReasons(o.provider, o.model);
    const cols: Array<0 | 1 | 2> = showVariant ? [0, 1, 2] : [0, 1];
    return cols.map((col) => {
      const title = col === 0 ? "provider" : col === 1 ? `model · ${o.provider}` : "variant";
      if (col > o.col) {
        const wait = col === 1 ? "choose a provider" : "choose a model";
        return { title, active: false, items: [{ label: wait, cursor: false, muted: true }] };
      }
      const active = col === o.col;
      const cells = active ? explorerCells(o) : cellsForCol(o, col);
      const sel = col === 0 ? o.provider : col === 1 ? o.model : o.variant;
      const focus = active
        ? o.idx
        : Math.max(
            0,
            cells.findIndex((c) => c.value === sel),
          );
      // Long catalogs (models.dev) scroll: a window that follows the cursor,
      // with faint overflow markers above/below.
      const win = windowList(cells, focus, EXPLORER_ROWS);
      const items: ConfigOverlayColumn["items"] = [];
      if (win.omittedAbove > 0)
        items.push({ label: `↑ ${win.omittedAbove} more`, cursor: false, muted: true });
      for (let i = 0; i < win.items.length; i += 1) {
        const c = win.items[i];
        const full = win.start + i;
        items.push({
          label: c.label,
          ...(c.note ? { note: c.note } : {}),
          cursor: active ? full === o.idx : c.value === sel,
          muted: !active,
        });
      }
      if (win.omittedBelow > 0)
        items.push({ label: `↓ ${win.omittedBelow} more`, cursor: false, muted: true });
      return { title, active, ...(active ? { search: o.query } : {}), items };
    });
  };

  const trustItems = (): Item[] => {
    const out: Item[] = [];
    out.push({
      focusable: true,
      row: {
        label: "Uncaged",
        value: data.trust.uncaged ? "ON" : "off",
        tone: data.trust.uncaged ? "danger" : "muted",
        note: layerNote(data.trust.uncagedLayer),
      },
      hint: "bypass the ACL — allow every gated tool call · ←→/space toggle",
      onLeft: () => ({ kind: "setUncaged", on: !data.trust.uncaged }),
      onRight: () => ({ kind: "setUncaged", on: !data.trust.uncaged }),
      onEnter: () => ({ kind: "setUncaged", on: !data.trust.uncaged }),
    });
    out.push({
      focusable: false,
      row: { label: "Rules", value: "decision", note: "source", header: true },
    });
    if (data.trust.uncaged) {
      out.push({
        focusable: false,
        row: { label: "⚠ open season — rules bypassed", header: true, tone: "danger" },
      });
      return out;
    }
    for (const r of data.trust.rules) {
      out.push({
        focusable: true,
        row: {
          label: r.pattern,
          value: r.decision,
          tone: decisionTone(r.decision),
          note: layerNote(r.layer),
        },
        hint: "pattern → decision · deny beats allow · ←→ decision · x remove",
        onLeft: () => cycleRule(r.pattern, -1),
        onRight: () => cycleRule(r.pattern, 1),
        onRemove: () => ({ kind: "removeRule", pattern: r.pattern }),
      });
    }
    out.push({
      focusable: true,
      row: { label: "+ add rule", action: true, tone: "accent" },
      hint: "add an allow rule from an idiomatic pattern · ⏎ open",
      onEnter: () => {
        overlay = { kind: "rule-add", idx: 0, decision: "allow" };
        return null;
      },
    });
    out.push({
      focusable: false,
      row: { label: "everything else", value: "deny", tone: "muted", divider: true },
    });
    return out;
  };

  const cycleRule = (pattern: string, dir: number): ConfigEffect | null => {
    const cur = data.trust.rules.find((r) => r.pattern === pattern);
    if (!cur) return null;
    const next = DECISIONS[(DECISIONS.indexOf(cur.decision) + dir + 3) % 3];
    return { kind: "setRule", pattern, decision: next };
  };

  // Open the API-key connect form, optionally pre-selecting a provider (when the
  // model picker routed here for a specific one).
  const openProviderForm = (provider?: string): null => {
    const idx = provider ? Math.max(0, data.connectableProviders.indexOf(provider)) : 0;
    overlay = { kind: "provider-add", field: 0, idx, apiKey: "" };
    return null;
  };

  // Open the cloud-auth setup form for a keyless provider, seeding each param
  // field with its sniffed default.
  const openCloudForm = (provider: string): null => {
    const params = data.cloudAuth[provider]?.params ?? [];
    overlay = { kind: "cloud-add", provider, field: 0, values: params.map((p) => p.value) };
    return null;
  };

  // Action rows below the params: run the login CLI (when it's installed) then
  // save. The first is the primary (⏎ on a param row triggers it).
  const cloudActions = (provider: string): string[] => {
    const info = data.cloudAuth[provider];
    return info?.cliAvailable && info.loginArgv.length ? ["login", "save"] : ["save"];
  };

  // Open the Miller picker for a role at a given column and provider. col 0 lands
  // on the provider (for browsing / after a cancel); col 1 lands on models (after
  // a successful connect).
  const openModelPicker = (role: "plan" | "build", provider: string, col: 0 | 1 | 2): void => {
    const rm = data.models[role];
    const o: ModelExplorer = {
      kind: "model",
      role,
      col,
      provider,
      model: rm.provider === provider ? rm.model : "",
      variant: rm.variant,
      query: "",
      idx: 0,
    };
    overlay = o;
    explorerReset(o); // sync the cursor to the current provider/model
  };

  // ---- provider catalog (the "Connect New Provider" surface, `n` in the picker) ----
  // Every real provider (openai-compatible needs a custom endpoint, set via
  // config), shown with connection status so you can connect / disconnect / set
  // up cloud auth without a separate top-level page.
  const catalogProviders = () => data.providers.filter((p) => p.name !== "openai-compatible");

  const openCatalog = (role: "plan" | "build", idx = 0): void => {
    overlay = { kind: "provider-catalog", role, idx };
  };

  // Open a connect/setup form for `provider`, remembering where to return.
  const openConnectForm = (provider: string, ret: FormReturn): void => {
    formReturn = ret;
    if (providerKeyless(provider)) openCloudForm(provider);
    else openProviderForm(provider);
  };

  // From the picker: the role's own provider is unconnected — connect it, then
  // resume the picker (advancing to its models once it's usable).
  const beginConnect = (role: "plan" | "build", provider: string): void =>
    openConnectForm(provider, { via: "picker", role, provider });

  // Esc from a connect/setup form returns to wherever it was opened from.
  const closeForm = (): void => {
    const ret = formReturn;
    formReturn = null;
    if (ret?.via === "catalog") openCatalog(ret.role, ret.idx);
    else if (ret?.via === "picker") openModelPicker(ret.role, ret.provider, 0);
    else overlay = null;
  };

  const mcpItems = (): Item[] => {
    const out: Item[] = [];
    for (const s of data.mcp) {
      out.push({
        focusable: true,
        row: { label: s.name, value: s.transport, tone: "muted", note: "● connected" },
        hint: "a Model Context Protocol server · x remove (hot-reloads)",
        onRemove: () => ({ kind: "removeServer", name: s.name }),
      });
    }
    out.push({
      focusable: true,
      row: { label: "+ add server", action: true, tone: "accent" },
      hint: "add a server — idempotent, hot-reloads instantly · ⏎ open",
      onEnter: () => {
        overlay = { kind: "server-add", field: 0, name: "", transport: "stdio", target: "" };
        return null;
      },
    });
    return out;
  };

  const focusableIndexes = (list: Item[]): number[] =>
    list.map((it, i) => (it.focusable ? i : -1)).filter((i) => i >= 0);

  const clampRow = (): void => {
    const focus = focusableIndexes(items());
    if (!focus.length) {
      row = 0;
      return;
    }
    if (!focus.includes(row)) row = focus[0];
  };

  const moveCursor = (dir: number): void => {
    const focus = focusableIndexes(items());
    if (!focus.length) return;
    const pos = focus.indexOf(row);
    const next = pos < 0 ? 0 : Math.max(0, Math.min(focus.length - 1, pos + dir));
    row = focus[next];
  };

  const switchSection = (dir: number): void => {
    section = (section + dir + SECTIONS.length) % SECTIONS.length;
    row = 0;
    overlay = null;
    clampRow();
  };

  const overlayKey = (key: KeyPress): ConfigEffect[] => {
    if (!overlay) return [];
    const esc = key.name === "escape";
    if (overlay.kind === "model") {
      const o = overlay;
      // Esc always cancels the picker — nothing is saved until a final commit.
      if (esc) {
        overlay = null;
        return [];
      }
      // ^n opens the catalog to connect a new provider (a plain letter would be
      // captured as column search, so this needs the modifier).
      if (key.name === "n" && key.ctrl) {
        openCatalog(o.role, 0);
        return [];
      }
      // ← steps back a column (a no-op on the first); only navigates, never saves.
      if (key.name === "left") {
        if (o.col > 0) {
          o.col = (o.col - 1) as 0 | 1 | 2;
          o.query = "";
          explorerReset(o);
        }
        return [];
      }
      const cells = explorerCells(o);
      if (key.name === "up") {
        o.idx = Math.max(0, o.idx - 1);
        explorerApply(o);
      } else if (key.name === "down") {
        o.idx = Math.min(Math.max(0, cells.length - 1), o.idx + 1);
        explorerApply(o);
      } else if (key.name === "right" || key.name === "return" || key.name === "kpenter") {
        explorerApply(o);
        if (o.col === 0) {
          const p = o.provider;
          // Only the role's own provider can sit here unconnected → connect it.
          if (!providerConnected(p)) {
            beginConnect(o.role, p);
            return [];
          }
          // A connected cloud provider: verify its live session (fetch a token)
          // before letting you into its models — creds present ≠ session valid.
          if (providerKeyless(p)) {
            checking = p;
            return [{ kind: "checkSession", provider: p, role: o.role }];
          }
          // A connected key provider goes straight through to its models.
        }
        // Commit only at the last column for this model (variant if it reasons,
        // else the model column). Otherwise advance.
        if (o.col < lastCol(o)) {
          o.col = (o.col + 1) as 0 | 1 | 2;
          o.query = "";
          explorerReset(o);
          return [];
        }
        const model = o.model.trim();
        if (!model) return [];
        const { role, provider } = o;
        overlay = null;
        // A non-reasoning model carries no variant override — the host uses its
        // profile default.
        return [
          modelReasons(provider, model)
            ? { kind: "setModel", role, model: `${provider}/${model}`, variant: o.variant }
            : { kind: "setModel", role, model: `${provider}/${model}` },
        ];
      } else {
        // Type to search the active column (col 1 also accepts a literal id).
        const edited =
          key.name === "backspace"
            ? o.query.slice(0, -1)
            : key.name === "space"
              ? `${o.query} `
              : key.char
                ? o.query + key.char
                : o.query;
        if (edited !== o.query) {
          o.query = edited;
          o.idx = 0;
          explorerApply(o);
        }
      }
      return [];
    }
    if (overlay.kind === "rule-add") {
      if (esc) {
        overlay = null;
        return [];
      }
      if (key.name === "up") overlay.idx = Math.max(0, overlay.idx - 1);
      else if (key.name === "down")
        overlay.idx = Math.min(RULE_SUGGESTIONS.length - 1, overlay.idx + 1);
      else if (key.name === "left" || key.name === "right") {
        const dir = key.name === "right" ? 1 : -1;
        overlay.decision = DECISIONS[(DECISIONS.indexOf(overlay.decision) + dir + 3) % 3];
      } else if (key.name === "return" || key.name === "kpenter") {
        const pattern = RULE_SUGGESTIONS[overlay.idx];
        const decision = overlay.decision;
        overlay = null;
        return [{ kind: "setRule", pattern, decision }];
      }
      return [];
    }
    if (overlay.kind === "server-add") {
      const form = overlay;
      if (esc) {
        overlay = null;
        return [];
      }
      if (key.name === "up") form.field = Math.max(0, form.field - 1);
      else if (key.name === "down" || key.name === "tab")
        form.field = Math.min(SERVER_FIELDS - 1, form.field + 1);
      else if (
        form.field === 1 &&
        (key.name === "left" || key.name === "right" || key.name === "space")
      )
        form.transport = form.transport === "stdio" ? "http" : "stdio";
      else if (key.name === "return" || key.name === "kpenter") {
        const name = form.name.trim();
        const target = form.target.trim();
        if (!name || !target) return []; // both required; keep the form open
        overlay = null;
        return [{ kind: "addServer", name, transport: form.transport, target }];
      } else if (form.field === 0 || form.field === 2) {
        // Text fields: backspace deletes, space and any printable char append.
        const edit = (s: string): string =>
          key.name === "backspace"
            ? s.slice(0, -1)
            : key.name === "space"
              ? `${s} `
              : key.char
                ? s + key.char
                : s;
        if (form.field === 0) form.name = edit(form.name);
        else form.target = edit(form.target);
      }
      return [];
    }
    if (overlay.kind === "provider-add") {
      const form = overlay;
      const list = data.connectableProviders;
      if (esc) {
        closeForm();
        return [];
      }
      if (key.name === "up") form.field = Math.max(0, form.field - 1);
      else if (key.name === "down" || key.name === "tab")
        form.field = Math.min(PROVIDER_FIELDS - 1, form.field + 1);
      else if (form.field === 0 && (key.name === "left" || key.name === "right") && list.length) {
        const dir = key.name === "right" ? 1 : -1;
        form.idx = (form.idx + dir + list.length) % list.length;
      } else if (key.name === "return" || key.name === "kpenter") {
        const provider = list[form.idx];
        const apiKey = form.apiKey.trim();
        if (!provider || !apiKey) return []; // both required; keep the form open
        overlay = null;
        return [{ kind: "connectProvider", provider, apiKey }];
      } else if (form.field === 1) {
        // The API-key field: backspace deletes, any printable char appends.
        form.apiKey =
          key.name === "backspace"
            ? form.apiKey.slice(0, -1)
            : key.name === "space"
              ? `${form.apiKey} `
              : key.char
                ? form.apiKey + key.char
                : form.apiKey;
      }
      return [];
    }
    if (overlay.kind === "cloud-add") {
      const form = overlay;
      const info = data.cloudAuth[form.provider];
      const params = info?.params ?? [];
      const actions = cloudActions(form.provider); // ["login","save"] | ["save"]
      const fieldCount = params.length + actions.length;
      if (esc) {
        closeForm();
        return [];
      }
      // Save the edited params to config (global — they pair with account-wide
      // credentials). Not scope-gated; the form stays open to then run login.
      const saveParams = (): ConfigEffect => {
        scope = "global";
        const config: Record<string, string> = {};
        params.forEach((p, i) => {
          const v = form.values[i]?.trim();
          if (v) config[p.key] = v;
        });
        return { kind: "setProviderConfig", provider: form.provider, config };
      };
      const runAction = (action: string): ConfigEffect =>
        action === "login"
          ? { kind: "runLogin", provider: form.provider, argv: info?.loginArgv ?? [] }
          : saveParams();
      if (key.name === "up") form.field = Math.max(0, form.field - 1);
      else if (key.name === "down" || key.name === "tab")
        form.field = Math.min(fieldCount - 1, form.field + 1);
      else if (key.name === "return" || key.name === "kpenter") {
        // On an action row → that action; on a param row → the primary action
        // (login when the CLI is available, else save).
        const onAction = form.field >= params.length;
        const action = onAction ? actions[form.field - params.length] : actions[0];
        return [runAction(action)];
      } else if (form.field < params.length) {
        // Edit the focused param field; command keys never collide with typing.
        const edit = (s: string): string =>
          key.name === "backspace"
            ? s.slice(0, -1)
            : key.name === "space"
              ? `${s} `
              : key.char
                ? s + key.char
                : s;
        form.values[form.field] = edit(form.values[form.field] ?? "");
      }
      return [];
    }
    if (overlay.kind === "provider-catalog") {
      const cat = overlay;
      const list = catalogProviders();
      if (esc) {
        // Back to the picker's provider column for this role.
        openModelPicker(cat.role, data.models[cat.role].provider, 0);
        return [];
      }
      if (key.name === "up") {
        cat.idx = Math.max(0, cat.idx - 1);
        return [];
      }
      if (key.name === "down") {
        cat.idx = Math.min(Math.max(0, list.length - 1), cat.idx + 1);
        return [];
      }
      const p = list[cat.idx];
      if (!p) return [];
      if (key.name === "return" || key.name === "kpenter") {
        // Connect / re-enter key (key provider) or set up cloud auth (keyless);
        // the form returns here when it closes.
        openConnectForm(p.name, { via: "catalog", role: cat.role, idx: cat.idx });
        return [];
      }
      if (key.name === "x" && p.connected && !p.keyless) {
        return [{ kind: "disconnectProvider", provider: p.name }];
      }
      return [];
    }
    return [];
  };

  const handleKey = (key: KeyPress): ConfigEffect[] => {
    toastText = undefined;
    // The scope prompt owns its keys and emits the held effect directly (past
    // the gate) so it isn't re-gated into another prompt.
    if (overlay?.kind === "scope-confirm") {
      const o = overlay;
      if (key.name === "escape") {
        overlay = null;
        return [];
      }
      if (key.name === "up") {
        o.idx = Math.max(0, o.idx - 1);
        return [];
      }
      if (key.name === "down") {
        o.idx = Math.min(SCOPES.length - 1, o.idx + 1);
        return [];
      }
      if (key.name === "return" || key.name === "kpenter" || key.name === "space") {
        scope = SCOPES[o.idx];
        overlay = null;
        return [o.pending];
      }
      return [];
    }
    // Any other overlay's commit is a write → route it through the gate.
    if (overlay) return gate(overlayKey(key));

    if ((key.name === "c" && key.ctrl) || key.name === "q") return [{ kind: "quit" }];
    if (key.name === "tab") {
      switchSection(key.shift ? -1 : 1);
      return [];
    }
    if (key.name === "up" || (key.name === "p" && key.ctrl)) {
      moveCursor(-1);
      return [];
    }
    if (key.name === "down" || (key.name === "n" && key.ctrl)) {
      moveCursor(1);
      return [];
    }
    if (key.name === "r" && SECTIONS[section] === "mcp") return [{ kind: "reloadMcp" }];

    const it = items()[row];
    if (!it) return [];
    // Inline edits are writes too — gate() holds the effect and opens the scope
    // prompt. onEnter that only opens an overlay returns null → gate([]) → [].
    if (key.name === "left") return gate(effect(it.onLeft?.()));
    if (key.name === "right") return gate(effect(it.onRight?.()));
    if (key.name === "return" || key.name === "kpenter" || key.name === "space") {
      // onEnter (even returning null — it opened an overlay) takes precedence;
      // rows without one fall back to a right-cycle so ⏎ still edits.
      if (it.onEnter) return gate(effect(it.onEnter()));
      return gate(effect(it.onRight?.()));
    }
    if (key.name === "x") return gate(effect(it.onRemove?.()));
    return [];
  };

  const effect = (e: ConfigEffect | null | undefined): ConfigEffect[] => (e ? [e] : []);

  // A short, human label for the pending change, shown atop the scope prompt.
  const describeEffect = (e: ConfigEffect): string => {
    switch (e.kind) {
      case "setModel":
        return `${e.role} model → ${e.model}${e.variant ? ` · ${e.variant}` : ""}`;
      case "setRule":
        return `${e.decision}  ${e.pattern}`;
      case "removeRule":
        return `remove rule  ${e.pattern}`;
      case "setUncaged":
        return `uncaged: ${e.on ? "on" : "off"}`;
      case "connectProvider":
        return `connect ${e.provider}`;
      case "disconnectProvider":
        return `disconnect ${e.provider}`;
      case "addServer":
        return `add server ${e.name}`;
      case "removeServer":
        return `remove server ${e.name}`;
      default:
        return "save change";
    }
  };

  // Effects that don't write a config layer, so the scope prompt doesn't apply:
  // keychain writes, the imperative login, and the non-write signals. Cloud
  // params (setProviderConfig) DO write config but pick their own layer (global).
  const UNGATED_EFFECTS = new Set([
    "quit",
    "reloadMcp",
    "connectProvider",
    "disconnectProvider",
    "runLogin",
    "checkSession",
    "setProviderConfig",
  ]);

  // Every layered config write passes through here: instead of applying
  // immediately, hold the effect and open the scope prompt (default Project).
  const gate = (effects: ConfigEffect[]): ConfigEffect[] => {
    const e = effects[0];
    if (!e || UNGATED_EFFECTS.has(e.kind)) return effects;
    overlay = {
      kind: "scope-confirm",
      pending: e,
      label: describeEffect(e),
      idx: Math.max(0, SCOPES.indexOf("project")),
    };
    return [];
  };

  const view = (): ConfigView => {
    const list = items();
    clampRow();
    const rows: ConfigViewRow[] = list.map((it, i) => ({
      ...it.row,
      cursor: i === row && !overlay,
    }));
    const cur = list[row];
    const sec = SECTIONS[section];

    let ov: ConfigOverlayView | undefined;
    if (overlay && overlay.kind === "scope-confirm") {
      const o = overlay;
      // Each layer as a row: label + its file path, Project preselected.
      ov = {
        title: `save to · ${o.label}`,
        items: SCOPES.map((s, i) => ({
          label: SCOPE_LABELS[s],
          note: data.layerPaths[s],
          cursor: i === o.idx,
        })),
        keys: [
          ["↑↓", "layer"],
          ["⏎", "save"],
          ["esc", "discard"],
        ],
      };
    } else if (overlay && overlay.kind === "model") {
      const o = overlay;
      ov = {
        title: checking ? `${o.role} model · checking ${checking} session…` : `${o.role} model`,
        items: [],
        columns: explorerColumns(o),
        keys: [
          ["↑↓", "move"],
          ["type", "search"],
          ["→ ⏎", "open · select"],
          ["^n", "connect new"],
          ["←", "back"],
          ["esc", "cancel"],
        ],
      };
    } else if (overlay && overlay.kind === "provider-catalog") {
      const cat = overlay;
      const list = catalogProviders();
      // Windowed list of every provider with a status glyph + one-line hint.
      const win = windowList(list, cat.idx, EXPLORER_ROWS);
      const statusOf = (p: (typeof list)[number]): string =>
        p.keyless
          ? p.connected
            ? "cloud ✓"
            : "cloud · connect"
          : p.connected
            ? "key ✓"
            : "no key";
      const items: ConfigOverlayView["items"] = [];
      if (win.omittedAbove > 0) items.push({ label: `↑ ${win.omittedAbove} more`, cursor: false });
      for (let i = 0; i < win.items.length; i += 1) {
        const p = win.items[i];
        items.push({ label: p.name, note: statusOf(p), cursor: win.start + i === cat.idx });
      }
      if (win.omittedBelow > 0) items.push({ label: `↓ ${win.omittedBelow} more`, cursor: false });
      const focused = list[cat.idx];
      ov = {
        title: "connect a provider",
        items,
        keys: [
          ["↑↓", "move"],
          ["⏎", focused?.keyless ? "set up" : focused?.connected ? "re-key" : "connect"],
          ...(focused?.connected && !focused.keyless
            ? ([["x", "disconnect"]] as Array<[string, string]>)
            : []),
          ["esc", "back"],
        ],
      };
    } else if (overlay && overlay.kind === "rule-add") {
      const o = overlay;
      ov = {
        title: `add rule · ${o.decision}`,
        items: RULE_SUGGESTIONS.map((p, i) => ({ label: p, cursor: i === o.idx })),
        keys: [
          ["↑↓", "move"],
          ["←→", "decision"],
          ["⏎", "add"],
          ["esc", "cancel"],
        ],
      };
    } else if (overlay && overlay.kind === "server-add") {
      const o = overlay;
      // A caret marks the focused text field; empty fields show a hint.
      const field = (value: string, focused: boolean, hint: string): string =>
        focused ? `${value}▏` : value || hint;
      ov = {
        title: "add MCP server",
        items: [
          { label: "name", note: field(o.name, o.field === 0, "…"), cursor: o.field === 0 },
          {
            label: "transport",
            note: o.transport === "stdio" ? "‹stdio› http" : "stdio ‹http›",
            cursor: o.field === 1,
          },
          {
            label: o.transport === "http" ? "url" : "command",
            note: field(o.target, o.field === 2, o.transport === "http" ? "https://…" : "npx …"),
            cursor: o.field === 2,
          },
        ],
        keys: [
          ["↑↓", "field"],
          ["←→", "transport"],
          ["type", "edit"],
          ["⏎", "add + reload"],
          ["esc", "cancel"],
        ],
      };
    } else if (overlay && overlay.kind === "provider-add") {
      const o = overlay;
      const provider = data.connectableProviders[o.idx] ?? "";
      const masked = "•".repeat(o.apiKey.length);
      ov = {
        title: "connect provider",
        items: [
          { label: "provider", note: `←→ ${provider}`, cursor: o.field === 0 },
          {
            label: "api key",
            note: o.field === 1 ? `${masked}▏` : masked || "paste key",
            cursor: o.field === 1,
          },
        ],
        keys: [
          ["↑↓", "field"],
          ["←→", "provider"],
          ["type", "key"],
          ["⏎", "connect"],
          ["esc", "cancel"],
        ],
      };
    } else if (overlay && overlay.kind === "cloud-add") {
      const o = overlay;
      const info = data.cloudAuth[o.provider];
      const params = info?.params ?? [];
      const actions = cloudActions(o.provider);
      const field = (value: string, focused: boolean, hint: string): string =>
        focused ? `${value}▏` : value || hint;
      // Status line: whether creds are already detected + the login command.
      const status = info?.credsPresent
        ? "credentials detected ✓"
        : info?.cliAvailable
          ? `not found · ⏎ runs: ${info.loginArgv.join(" ")}`
          : `not found · run: ${(info?.loginArgv ?? []).join(" ")}`;
      const items = [
        ...params.map((p, i) => ({
          label: p.label,
          note: field(o.values[i] ?? "", o.field === i, p.placeholder),
          cursor: o.field === i,
        })),
        ...actions.map((a, i) => ({
          label: a === "login" ? "▸ run login" : "▸ save params",
          note: a === "login" ? info?.loginArgv.join(" ") : "→ global",
          cursor: o.field === params.length + i,
        })),
      ];
      ov = {
        title: `connect ${o.provider} · ${status}`,
        items,
        keys: [
          ["↑↓", "field"],
          ["type", "edit"],
          ["⏎", "run · save"],
          ["esc", "cancel"],
        ],
      };
    }

    // Only advertise keys the focused row actually responds to, so ←→/⏎/x never
    // show on a row that ignores them.
    const pair = (k: string, label: string): Array<[string, string]> => [[k, label]];
    const keys: Array<[string, string]> = [
      ["↑↓", "move"],
      ["tab", "section"],
      ...(cur?.onLeft || cur?.onRight ? pair("←→", "change") : []),
      ...(cur?.onEnter ? pair("⏎", cur.row.action ? "open" : "edit") : []),
      ...(cur?.onRemove ? pair("x", "remove") : []),
      ...(sec === "mcp" ? pair("r", "reload") : []),
      ["q", "quit"],
    ];

    return {
      title: `glorious config · ${SECTION_LABELS[sec]}`,
      sections: SECTIONS.map((s, i) => ({ label: SECTION_LABELS[s], active: i === section })),
      rows,
      hint: overlay ? undefined : cur?.hint,
      keys,
      overlay: ov,
      toast: toastText,
      // The footer advertises the default save target (Project); the actual
      // layer is confirmed per-change in the scope prompt.
      scope: "project",
      scopeLabel: SCOPE_LABELS.project,
      scopePath: data.layerPaths.project,
    };
  };

  return {
    view,
    handleKey,
    scope: () => scope,
    reportSessionCheck(provider, result) {
      checking = null;
      // The picker may have moved on (Esc / different provider) while we waited.
      if (overlay?.kind !== "model" || overlay.provider !== provider || overlay.col !== 0) return;
      const o = overlay;
      if (result === "valid") {
        // Session good → into its models.
        o.col = 1;
        o.query = "";
        explorerReset(o);
      } else {
        // Stale (needs re-auth) or missing → open the setup form; running the
        // login there resumes the picker at this provider's models.
        openConnectForm(provider, { via: "picker", role: o.role, provider });
      }
    },
    reload(next) {
      data = next;
      // A form opened from the picker: once its provider is usable, advance to
      // that provider's models. A form opened from the catalog: reopen the
      // catalog when the form closed (a key connect); a still-open cloud form
      // stays put so multi-step setup can continue.
      if (formReturn?.via === "picker" && providerConnected(formReturn.provider)) {
        const { role, provider } = formReturn;
        formReturn = null;
        openModelPicker(role, provider, 1);
      } else if (formReturn?.via === "catalog" && !overlay) {
        const { role, idx } = formReturn;
        formReturn = null;
        openCatalog(role, idx);
      }
      clampRow();
    },
    toast(text) {
      toastText = text;
    },
  };
}
