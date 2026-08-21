import { runShell } from "../../glrs-core/src/shell";
import { loadConfig, registerExtensionProvider } from "../../provider-registry/src";
import { createRegistry, type ExtensionHost, type Line } from "./extension-api";
import { firstPartyExtensions, loadExtensions } from "./extensions";
import { clip, width } from "./render";

// The third way glrs runs, after the TUI and `-p`: a subcommand an extension
// added. `glrs wt list` opens no session, calls no model and never touches the
// alternate screen — it loads the extensions, hands one its arguments, and
// exits.
//
// Extensions are loaded to find out whether a word is a subcommand, which is
// why this is reached only after glrs's own words have been ruled out. A bare
// `glrs`, `glrs -p …` and `glrs doctor` never pay for it.

// Every member a session provides and a subcommand does not. Filled in one
// place so adding one to ExtensionHost cannot silently leave this host with a
// hole in it: the type will demand it here too, and until someone decides what
// it means outside a session, saying so is better than a plausible lie.
const needsSession = (member: string): never => {
  throw new Error(
    `g.${member}() needs a session, and a glrs subcommand runs outside one. ` +
      "Use a slash command or a tool for anything that talks to the model.",
  );
};

const flatten = (content: string | Line[]): string =>
  typeof content === "string"
    ? content
    : content.map((line) => line.map((span) => span.text).join("")).join("\n");

// `available` carries what was registered, so a miss can name the subcommands
// that do exist. The extensions are loaded by then and asking them is free;
// making the caller load them again to write an error message would not be.
// Which word in argv is the subcommand: the first bare one that is not some
// flag's value. `--model x doctor` finds `doctor`; `glrs wt doctor` finds `wt`,
// because a subcommand's own arguments are not glrs's to interpret. Scanning for
// a known word anywhere meant `glrs wt doctor` ran glrs's doctor and the
// extension never saw it.
export const subcommandOf = (
  args: readonly string[],
): { name: string; rest: readonly string[] } | null => {
  const at = args.findIndex(
    (arg, index) => !arg.startsWith("-") && !args[index - 1]?.startsWith("-"),
  );
  return at < 0 ? null : { name: args[at], rest: args.slice(at + 1) };
};

export type CliOutcome = {
  handled: boolean;
  available: ReadonlyArray<readonly [string, { readonly description: string }]>;
};

export const runCli = async (
  name: string,
  args: readonly string[],
  where: { root: string },
): Promise<CliOutcome> => {
  const config = await loadConfig(where.root);
  const registry = createRegistry();

  const host: ExtensionHost = {
    root: where.root,
    mode: "cli",
    exec: (command, extra) => runShell(where.root, command, extra),
    // Straight to stdout. A subcommand's output is something you pipe into
    // another command, so it is not decorated and not wrapped.
    print: (content) => process.stdout.write(`${flatten(content)}\n`),
    columns: () =>
      process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 100,
    settings: () => ({
      toolTimeoutMs: config.config.toolTimeoutMs,
      reasoningDisplay: config.config.reasoningDisplay,
      steeringMode: config.config.steeringMode,
      followUpMode: config.config.followUpMode,
    }),
    available: () => firstPartyExtensions(config.config.extensions),
    // Reading the roster is fine here; changing it is a decision somebody
    // agreed to in conversation, and there is no conversation.
    setExtension: async () => "not-allowed",
    inspect: () => ({ commands: [], skills: [], extensions: [], keys: [], flags: [] }),
    send: () => needsSession("send"),
    setInput: () => needsSession("setInput"),
    capture: () => needsSession("ui.capture"),
    mount: () => needsSession("ui.mount"),
    notify: (message) => process.stdout.write(`${message}\n`),
    setTheme: () => ({ restore: () => {} }),
    autocomplete: () => ({ dispose: () => {} }),
    clear: () => needsSession("clear"),
    compact: () => needsSession("compact"),
    reload: () => needsSession("reload"),
    tools: () => needsSession("tools"),
    setToolFilters: () => needsSession("filterTools"),
    model: () => needsSession("model"),
    models: () => needsSession("models"),
    setModel: () => needsSession("setModel"),
    rememberModel: () => needsSession("rememberModel"),
    registerProvider: registerExtensionProvider,
    history: () => needsSession("history"),
    forkSession: () => needsSession("forkSession"),
    switchSession: () => needsSession("switchSession"),
    setLabel: () => needsSession("setLabel"),
    idle: () => needsSession("idle"),
    pending: () => needsSession("pending"),
    abort: () => needsSession("abort"),
    usage: () => needsSession("usage"),
    systemPrompt: () => needsSession("systemPrompt"),
    shutdown: () => needsSession("shutdown"),
    session: () => needsSession("session"),
    setSessionName: () => needsSession("setSessionName"),
    appendEntry: () => needsSession("appendEntry"),
    entries: () => needsSession("entries"),
  };

  const loaded = await loadExtensions(where.root, registry, host, () => {}, {
    settings: config.config.extensions,
  });
  for (const failure of loaded.failures)
    process.stderr.write(`[extension ${failure.origin}] ${failure.message}\n`);

  const available = [...registry.cli.entries()].map(
    ([registered, spec]) => [registered, { description: spec.description }] as const,
  );
  const found = registry.cli.get(name.toLowerCase());
  if (found === undefined) return { handled: false, available };

  await found.run(args);
  return { handled: true, available };
};

// What `glrs --help` says an extension has added, so a subcommand that exists
// is discoverable without reading the extension. Resolving is not enough — a
// subcommand is registered while the extension runs — so this is only worth
// calling once the extensions are already loaded.
export const cliUsage = (
  entries: ReadonlyArray<readonly [string, { readonly description: string }]>,
  columns = 80,
): string => {
  if (entries.length === 0) return "";
  const pad = Math.max(...entries.map(([name]) => width(name)));
  return [
    "",
    "Added by extensions:",
    ...entries.map(
      ([name, spec]) =>
        `  glrs ${name.padEnd(pad)}  ${clip(spec.description, Math.max(20, columns - pad - 9))}`,
    ),
  ].join("\n");
};
