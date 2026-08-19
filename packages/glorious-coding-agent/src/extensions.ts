import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import askUser from "../../extensions/ask-user/src";
import builtins from "../../extensions/builtins/src";
import webFetch from "../../extensions/web-fetch/src";
import { createApi, type ExtensionHost, type Registry } from "./extension-api";
import { describeThrown } from "./render";
import type { ToolEvent } from "./tools";
import { agentDirectories } from "./usercommands";

// An extension is a TypeScript file that registers capabilities against the API
// in extension-api.ts. Bun imports .ts directly, so loading one is a dynamic
// import and nothing else — no build step, no transpiler, no new dependency.
//
// They run with full permissions and there is no approval gate. That is the
// same bet the rest of glorious makes: an agent that can write and run code has
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

const bundled = [
  { name: "ask-user", origin: "@glrs-dev/glorious-ask-user", load: askUser },
  { name: "builtins", origin: "@glrs-dev/glorious-builtins", load: builtins },
  { name: "web-fetch", origin: "@glrs-dev/glorious-web-fetch", load: webFetch },
];

// Each extension is loaded and invoked on its own, so one that throws on import
// or in its factory costs only itself. Bundled ones come first, and a project
// can shadow one by name — replacing web_fetch is a supported thing to do.
export const loadExtensions = async (
  root: string,
  registry: Registry,
  host: ExtensionHost,
  onToolEvent: (event: ToolEvent) => void,
  // Appended to the import specifier so a reload re-reads the file. Without it
  // the module cache hands back the version loaded at startup, and editing an
  // extension would appear to do nothing.
  token?: string,
): Promise<ExtensionLoad> => {
  const seen = new Set<string>();
  const extensions: LoadedExtension[] = [];
  const failures: ExtensionLoad["failures"] = [];

  const found = (await Promise.all(extensionRoots(root).map(entryPoints))).flat();

  for (const entry of found) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    try {
      const specifier = resolve(entry.path);
      const module = (await import(token === undefined ? specifier : `${specifier}?${token}`)) as {
        default?: (glorious: ReturnType<typeof createApi>) => void | Promise<void>;
      };
      if (typeof module.default !== "function")
        throw new Error("no default export — an extension exports a function taking (glorious)");
      // Awaited before the session starts, so an extension that fetches or
      // reads on the way up has finished registering before the first turn.
      await module.default(createApi(host, registry, onToolEvent, entry.path));
      extensions.push({ name: entry.name, origin: entry.path });
    } catch (thrown) {
      failures.push({ origin: entry.path, message: failureText(thrown) });
    }
  }
  for (const entry of bundled) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    try {
      await entry.load(createApi(host, registry, onToolEvent, entry.origin) as never);
      extensions.push({ name: entry.name, origin: entry.origin });
    } catch (thrown) {
      failures.push({ origin: entry.origin, message: failureText(thrown) });
    }
  }
  return { extensions, failures };
};
