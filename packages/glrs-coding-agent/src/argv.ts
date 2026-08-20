import { command, flag, option, optional, restPositionals, runSafely, string } from "cmd-ts";

// What argv means, decided in one place, by cmd-ts.
//
// This was index arithmetic over `process.argv` inside `main()`, and every bug
// it had came from one root: a flag's value was whatever token sat beside it.
// `--model -p hi` set the model to "-p"; `--resume --model x` looked for a
// session called "--model"; a trailing `--model` was dropped in silence; and
// `--Foo` vanished without even the "(unknown flag:)" line, because the scan
// was lowercase-only. cmd-ts rejects the last two by construction and the first
// two through the types below.
//
// cmd-ts cannot own the whole tree. An extension's subcommand is not known
// until extensions load, and glrs deliberately does not load them for a bare
// `glrs`, a `-p` run or `glrs doctor`. So the first bare word is classified
// here first, and only a word glrs does not claim reaches the extension host.

export class ArgvError extends Error {}

// A model id, not merely a string. cmd-ts is happy to take `-p` as the value of
// `--model`, so the check that it is not another flag lives in the type.
const ModelId = {
  ...string,
  displayName: "provider/model",
  description: "a model id, as in anthropic/claude-opus-4-1",
  async from(raw: string): Promise<string> {
    if (raw.startsWith("-"))
      throw new Error(`--model needs a model id, and "${raw}" is another flag.`);
    if (raw.trim() === "") throw new Error("--model needs a model id.");
    if (!raw.includes("/"))
      throw new Error(
        `--model needs provider/model-id, and "${raw}" names no provider. ` +
          "There is no default provider — see `glrs doctor`.",
      );
    return raw;
  },
};

// `--resume` alone opens the picker and `--resume <id>` opens that session.
// cmd-ts has no optional-valued option, so a bare `--resume` is normalised to
// `--resume=` before parsing and an empty string means the picker.
const SessionId = {
  ...string,
  displayName: "session-id",
  async from(raw: string): Promise<string> {
    if (raw.startsWith("-"))
      throw new Error(`--resume takes a session id, and "${raw}" is another flag.`);
    return raw;
  },
};

const chat = command({
  name: "glrs",
  description: "start a session",
  args: {
    model: option({ long: "model", type: optional(ModelId), description: "model for this run" }),
    resume: option({
      long: "resume",
      type: optional(SessionId),
      description: "resume a session; no id opens the picker",
    }),
    print: option({ long: "print", short: "p", type: optional(string), description: "headless" }),
    rest: restPositionals({ type: string }),
  },
  handler: (args) => args,
});

const doctor = command({
  name: "doctor",
  description: "report the resolved model, credentials and extensions",
  args: { json: flag({ long: "json", description: "emit the report as JSON" }) },
  handler: (args) => args,
});

const update = command({
  name: "update",
  description: "upgrade glrs in place",
  args: {},
  handler: () => ({}),
});

export type Route =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "update" }
  | { kind: "doctor"; json: boolean }
  | { kind: "print"; prompt: string; model?: string }
  | { kind: "chat"; resume?: string; picker: boolean; model?: string; flags: Map<string, string> }
  | { kind: "subcommand"; name: string; rest: readonly string[] };

const OWN = new Set(["doctor", "update"]);

// The first token that is not a flag and is not some flag's value.
export const subcommandOf = (
  args: readonly string[],
): { name: string; rest: readonly string[] } | null => {
  const at = args.findIndex(
    (arg, index) => !arg.startsWith("-") && !args[index - 1]?.startsWith("-"),
  );
  return at < 0 ? null : { name: args[at] ?? "", rest: args.slice(at + 1) };
};

const nameOf = (arg: string): string | null => {
  const found = /^--([A-Za-z][\w-]*)(?:=.*)?$/u.exec(arg);
  return found ? (found[1] ?? "").toLowerCase() : null;
};

const KNOWN = new Set(["model", "resume", "print", "json", "version", "help"]);

// cmd-ts rejects a flag it does not know, which is exactly right for glrs's own
// surface and exactly wrong for a flag an extension will claim once it loads.
// So they are lifted out before parsing and carried separately. Uppercase is
// accepted here — `--Foo` used to match nothing and disappear without a word.
const liftExtensionFlags = (
  args: readonly string[],
): { kept: string[]; flags: Map<string, string> } => {
  const kept: string[] = [];
  const flags = new Map<string, string>();
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    const name = nameOf(arg);
    if (name === null || KNOWN.has(name)) {
      kept.push(arg);
      continue;
    }
    const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }
    const next = args[at + 1];
    const takesNext = next !== undefined && !next.startsWith("-");
    flags.set(name, takesNext ? next : "");
    if (takesNext) at += 1;
  }
  return { kept, flags };
};

// cmd-ts reports through a coloured, multi-line block meant for a terminal:
//
//   error: found 1 error
//
//     --model -p
//      ^ is another flag
//
// The useful half is the offending fragment and the caret line. Both are pulled
// out so the thrown message is one sentence, since main() writes it to stderr
// beside everything else glrs can fail with.
const failed = (result: { error?: unknown }): string => {
  const raw = (result.error as { config?: { message?: string } })?.config?.message ?? "";
  const lines = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR codes
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const caret = lines.findIndex((line) => line.startsWith("^"));
  if (caret < 0)
    return lines.find((l) => !l.startsWith("error:")) ?? "could not read the arguments";
  const why = lines[caret]?.slice(1).trim() ?? "";
  const what = lines[caret - 1] ?? "";
  return what === "" ? why : `${what} — ${why}`;
};

export const route = async (argv: readonly string[]): Promise<Route> => {
  if (argv.includes("--version") || argv.includes("-v")) return { kind: "version" };
  if (argv.includes("--help") || argv.includes("-h")) return { kind: "help" };

  const word = subcommandOf(argv);
  const printAt = argv.findIndex((arg) => arg === "-p" || arg === "--print");
  const wordAt = word === null ? -1 : argv.indexOf(word.name);
  // Whichever comes first wins. `glrs wt -p hi` is the worktree subcommand
  // being passed `-p` (it used to run a headless turn and throw `wt` away,
  // because -p was matched wherever it sat); `glrs -p what failed` is a prompt,
  // and `failed` is not a subcommand just because a bare word precedes it.
  const isSubcommand = word !== null && !OWN.has(word.name) && (printAt < 0 || wordAt < printAt);
  if (isSubcommand && word !== null)
    return { kind: "subcommand", name: word.name, rest: word.rest };

  if (word?.name === "update") return { kind: "update" };
  if (word?.name === "doctor") {
    const parsed = await runSafely(
      doctor,
      argv.filter((arg) => arg !== "doctor"),
    );
    if (parsed._tag !== "ok") throw new ArgvError(failed(parsed));
    return { kind: "doctor", json: parsed.value.json };
  }

  // cmd-ts drops an option given no value rather than complaining, so a
  // trailing `--model`, or one whose value is the next flag, would silently
  // start an ordinary session — the bug this module exists to remove. Checked
  // before either branch parses, so `--model -p hi` cannot slip through as a
  // headless run with no model.
  const modelAt = argv.indexOf("--model");
  if (modelAt >= 0) {
    const next = argv[modelAt + 1];
    if (next === undefined) throw new ArgvError("--model needs a value.");
    if (next.startsWith("-"))
      throw new ArgvError(`--model needs a model id, and "${next}" is another flag.`);
  }

  // Everything after -p is the prompt, taken verbatim. It is free text, so it
  // does not go through the parser at all: a prompt mentioning --model or a
  // bare word is a prompt, not an argument. Only what precedes -p is parsed.
  if (printAt >= 0) {
    const before = await runSafely(chat, liftExtensionFlags(argv.slice(0, printAt)).kept);
    if (before._tag !== "ok") throw new ArgvError(failed(before));
    return {
      kind: "print",
      prompt: argv
        .slice(printAt + 1)
        .join(" ")
        .trim(),
      model: before.value.model,
    };
  }

  const { kept, flags } = liftExtensionFlags(argv);

  // `--resume` alone means the picker. cmd-ts has no optional-valued option and
  // reads `--resume=` as absent, so the bare form is settled here and hidden
  // from the parser; `--resume <id>` is left for cmd-ts to type-check.
  const bareResume = kept.some(
    (arg, at) =>
      arg === "--resume" && (kept[at + 1] === undefined || kept[at + 1]?.startsWith("-")),
  );
  const forParser = bareResume ? kept.filter((arg) => arg !== "--resume") : kept;

  const parsed = await runSafely(chat, forParser);
  if (parsed._tag !== "ok") throw new ArgvError(failed(parsed));
  const { model, resume } = parsed.value;

  return { kind: "chat", resume, picker: bareResume, model, flags };
};

// `--help` is the one route that loads extensions to answer, because a
// subcommand an extension added is discoverable only by asking it.
export const helpText = (
  added: ReadonlyArray<readonly [string, { readonly description: string }]> = [],
): string => {
  const own: Array<[string, string]> = [
    ["doctor [--json]", doctor.description ?? ""],
    ["update", update.description ?? ""],
  ];
  const extra = added.map(([name, spec]) => [name, spec.description] as [string, string]);
  const flags: Array<[string, string]> = [
    ["-p, --print <prompt>", "run one turn headless and exit; reads piped stdin too"],
    ["--model <provider/id>", "override the model for this run"],
    ["--resume [session-id]", "resume a session, or pick one when given no id"],
    ["--version", "print the version"],
    ["--help", "this"],
  ];
  const pad = Math.max(...[...own, ...extra, ...flags].map(([left]) => left.length));
  const block = (title: string, items: Array<[string, string]>): string[] =>
    items.length === 0
      ? []
      : ["", `${title}:`, ...items.map(([l, r]) => `  ${l.padEnd(pad)}  ${r}`)];
  return [
    "glrs — a terminal coding agent",
    "",
    "Usage: glrs [options]           start a session",
    "       glrs -p <prompt>         one headless turn",
    "       glrs <command> [args]    run a command",
    ...block("Commands", own),
    ...block("Added by extensions", extra),
    ...block("Options", flags),
    "",
  ].join("\n");
};
