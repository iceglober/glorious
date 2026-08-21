import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import askUser from "../../extensions/ask-user/src";
import builtins from "../../extensions/builtins/src";
import webFetch from "../../extensions/web-fetch/src";
import worktree from "../../extensions/worktree/src";
import type { FirstPartyExtension } from "../../glrs-core/src";
import { createApi, type ExtensionHost, type Registry } from "./extension-api";
import { describeThrown } from "./render";
import type { ToolEvent } from "./toolkit";
import { agentDirectories } from "./usercommands";

export type { FirstPartyExtension };

// An extension is a TypeScript file that registers capabilities against the API
// in extension-api.ts. Bun imports .ts directly, so loading one is a dynamic
// import and nothing else — no build step, no transpiler, no new dependency.
//
// They run with full permissions and there is no approval gate. That is the
// same bet the rest of glrs makes: an agent that can write and run code has
// already crossed the line a prompt could defend, so the honest thing is to say
// so and make what loaded visible instead of asking a question whose only
// answer is yes. /extensions lists what loaded and from where, and a file that
// fails to load says so loudly rather than disappearing.

export type LoadedExtension = {
  name: string;
  origin: string;
};

export type ExtensionLoad = {
  extensions: LoadedExtension[];
  failures: Array<{ origin: string; message: string }>;
  // Nothing is broken, but something is worth knowing — a file that took a
  // shipped extension's name and the capability that went with it.
  notes: string[];
};

const extensionRoots = (root: string): string[] =>
  agentDirectories(root).map((directory) => join(directory, "extensions"));

// `foo.ts` and `foo/index.ts` are both one extension named foo. The directory
// form is for extensions that outgrow a file, and it is where a package.json
// with its own dependencies would sit.
const entryPoints = async (directory: string): Promise<Array<{ name: string; path: string }>> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const found: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      found.push({
        name: basename(entry.name, ".ts").toLowerCase(),
        path: join(directory, entry.name),
      });
    else if (entry.isDirectory() || entry.isSymbolicLink())
      found.push({
        name: entry.name.toLowerCase(),
        path: join(directory, entry.name, "index.ts"),
      });
  }
  return found;
};

const failureText = (thrown: unknown): string => {
  if (!(thrown instanceof Error)) return describeThrown(thrown);
  // A missing index.ts is what a directory with no entry point looks like, and
  // saying "Cannot find module" about a path the user never typed is worse than
  // saying nothing happened.
  return /Cannot find module/u.test(thrown.message) ? "no index.ts" : thrown.message;
};

// What each shipped extension is worth saying about, when a file on disk takes
// its name and the shipped one therefore does not load. Shadowing was always
// supported and is still the point; `builtins` is the one whose loss is worth
// interrupting for, because it now carries the six tools as well as the seven
// commands and an agent without them cannot do anything at all.
const shadowNote: Record<string, string> = {
  builtins:
    "shadows the extension that provides bash, read, write, edit, grep, glob and every slash command, the model has no tools unless yours registers them",
};

// Every first-party extension loads. Making the agent ask to turn one on put a
// decision in front of the user that they had no way to evaluate: the model
// advertised `web-fetch` before anyone had wanted a web page. Disable what you
// do not want, or shadow it with a file of the same name.
//
// `defaultOn` is what separates the extension the agent cannot work without
// from the ones that add a capability. builtins always loads unless you
// explicitly disable it; the rest wait to be named in `extensions.load`.
// `summary` is written for the model rather than for a listing: it is what the
// agent reads when deciding whether to suggest turning one on, so it says what
// the extension is for and not what it is called.
const bundled = [
  {
    name: "ask-user",
    origin: "@glrs-dev/glrs-ext-ask-user",
    load: askUser,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "ask-user"),
    summary: "asks the user a multiple-choice question and waits for the answer",
  },
  {
    name: "builtins",
    origin: "@glrs-dev/glrs-ext-builtins",
    load: builtins,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "builtins"),
    summary: "the file, search and shell tools, and every slash command",
  },
  {
    name: "worktree",
    origin: "@glrs-dev/glrs-ext-worktree",
    load: worktree,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "worktree"),
    summary:
      "creates git worktrees, and audits which ones still have sessions working in them; adds `glrs wt`",
  },
  {
    name: "web-fetch",
    origin: "@glrs-dev/glrs-ext-web-fetch",
    load: webFetch,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "web-fetch"),
    summary:
      "fetches web pages and returns them as markdown, rendering JavaScript when Chrome is installed",
  },
];

export const firstPartyExtensions = (settings?: ExtensionSettings): FirstPartyExtension[] => {
  const on = new Set((settings?.load ?? []).map(key));
  const off = new Set((settings?.disable ?? []).map(key));
  return bundled.map(({ name, origin, defaultOn, summary }) => {
    const named = on.has(key(name)) || on.has(key(origin));
    const banned = off.has(key(name)) || off.has(key(origin));
    return {
      name,
      summary,
      state: banned ? "off" : "on",
    };
  });
};

// What config says about which extensions load. Declared here rather than
// imported from provider-registry for the same reason QueueMode is declared
// twice: extension loading has no business depending on the model registry,
// and a structural type costs three lines.
export type ExtensionSettings = {
  load?: readonly string[];
  disable?: readonly string[];
};

const key = (name: string): string => name.trim().toLowerCase();

// Everything that would load, worked out without running any of it. `glrs
// doctor` reports from this: an extension is a program, and a diagnostic that
// executes programs is not a diagnostic.
export type Planned = {
  name: string;
  origin: string;
  source: "disk" | "bundled" | "config";
  // The directory the extension lives in. Its `skills/` subdirectory, if it has
  // one, joins the skill roots — which is why this is on the *plan*: working it
  // out must not require running the extension.
  dir: string;
  path?: string;
  load?: (glrs: never) => void | Promise<void>;
};

export type ExtensionPlan = {
  plan: Planned[];
  failures: Array<{ origin: string; message: string }>;
  notes: string[];
};

export const resolveExtensions = async (
  root: string,
  settings?: ExtensionSettings,
): Promise<ExtensionPlan> => {
  const plan: Planned[] = [];
  const failures: ExtensionPlan["failures"] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const off = new Set((settings?.disable ?? []).map(key));
  const wanted = new Set((settings?.load ?? []).map(key));
  const claimed = new Set<string>();

  const take = (name: string): "taken" | "off" | "free" => {
    if (seen.has(name)) return "taken";
    seen.add(name);
    if (off.has(name)) {
      claimed.add(name);
      return "off";
    }
    return "free";
  };

  // Discovery first, so the documented rule — the first file to claim a name
  // wins — is untouched by anything config says.
  for (const entry of (await Promise.all(extensionRoots(root).map(entryPoints))).flat()) {
    if (take(entry.name) !== "free") continue;
    plan.push({
      name: entry.name,
      origin: entry.path,
      source: "disk",
      dir: dirname(entry.path),
      path: entry.path,
    });
  }

  for (const entry of bundled) {
    const seat = take(entry.name);
    if (seat === "taken") {
      const cost = shadowNote[entry.name];
      if (cost !== undefined) notes.push(`${entry.name}.ts ${cost}`);
      continue;
    }
    if (seat === "off") continue;
    // Named by its own name or by the package it ships as. The roster already
    // records the specifier, so a config written today keeps working the day
    // these are installed rather than bundled.
    if (!entry.defaultOn && !wanted.has(key(entry.name)) && !wanted.has(key(entry.origin)))
      continue;
    plan.push({
      name: entry.name,
      origin: entry.origin,
      source: "bundled",
      dir: entry.dir,
      load: entry.load,
    });
  }

  // Whatever `load` named that discovery and the roster did not account for.
  for (const entry of settings?.load ?? []) {
    const name = key(entry);
    if (seen.has(name) || bundled.some((one) => key(one.origin) === name)) continue;
    if (entry.includes(":")) {
      failures.push({
        origin: entry,
        message: `"${entry.split(":")[0]}:" packages need an installer glrs does not have yet: name a bundled extension or a path`,
      });
      continue;
    }
    if (!isAbsolute(entry)) {
      const near = bundled.map((one) => one.name).join(", ");
      failures.push({
        origin: entry,
        message: `no extension by that name is bundled or on disk, glrs ships ${near}`,
      });
      continue;
    }
    const entryPath = (await stat(entry).catch(() => null))?.isDirectory()
      ? join(entry, "index.ts")
      : entry;
    if (!(await stat(entryPath).catch(() => null))?.isFile()) {
      failures.push({ origin: entry, message: `no such file: ${entryPath}` });
      continue;
    }
    const named = basename(entryPath, ".ts").toLowerCase();
    const label = named === "index" ? basename(dirname(entryPath)).toLowerCase() : named;
    if (take(label) !== "free") continue;
    plan.push({
      name: label,
      origin: entryPath,
      source: "config",
      dir: dirname(entryPath),
      path: entryPath,
    });
  }

  for (const one of settings?.disable ?? [])
    if (!claimed.has(key(one)))
      notes.push(`extensions.disable names "${one}", which is not an extension that would load`);

  return { plan, failures, notes };
};

// Each extension is loaded and invoked on its own, so one that throws on import
// or in its factory costs only itself. Files on disk are walked first and a
// project can shadow a shipped extension by name — replacing web_fetch is a
// supported thing to do. (An older comment here claimed bundled ones came
// first; they never have.)
// Where each extension that would load keeps its skills. Derived from the plan,
// so no extension has to run to answer it — which is what lets skills load at
// startup even though extensions do not load until much later.
//
// Deduplicated, because a disk extension's `dir` is the directory the file sits
// in — so two of them side by side in `~/.config/agents/extensions/` yield that
// one `skills/` directory twice. Discovery walks each root it is given, so a
// repeated root finds every skill under it again and warns that two skills share
// a name, naming the same path on both sides.
export const skillRootsFor = (plan: readonly Planned[]): string[] => [
  ...new Set(plan.map((entry) => join(entry.dir, "skills"))),
];

export const loadExtensions = async (
  root: string,
  registry: Registry,
  host: ExtensionHost,
  onToolEvent: (event: ToolEvent) => void,
  // `token` is appended to the import specifier so a reload re-reads the file;
  // without it the module cache hands back the version loaded at startup and
  // editing an extension appears to do nothing. A bag rather than a fifth
  // positional, because the next thing to arrive here is an install root.
  options: { token?: string; settings?: ExtensionSettings } = {},
): Promise<ExtensionLoad> => {
  const { plan, failures, notes } = await resolveExtensions(root, options.settings);
  const extensions: LoadedExtension[] = [];

  for (const entry of plan) {
    try {
      if (entry.path === undefined) {
        await entry.load?.(createApi(host, registry, onToolEvent, entry.origin) as never);
      } else {
        const specifier = resolve(entry.path);
        const module = (await import(
          options.token === undefined ? specifier : `${specifier}?${options.token}`
        )) as { default?: (glrs: ReturnType<typeof createApi>) => void | Promise<void> };
        if (typeof module.default !== "function")
          throw new Error("no default export, an extension exports a function taking (glrs)");
        // Awaited before the session starts, so an extension that fetches or
        // reads on the way up has finished registering before the first turn.
        await module.default(createApi(host, registry, onToolEvent, entry.path));
      }
      extensions.push({ name: entry.name, origin: entry.origin });
    } catch (thrown) {
      failures.push({ origin: entry.origin, message: failureText(thrown) });
    }
  }
  return { extensions, failures, notes };
};
