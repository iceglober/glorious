import { stderr as processStderr, stdout as processStdout } from "node:process";

import { command, runSafely } from "cmd-ts";

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_ABORTED = 130;

export const DEFAULT_COMMAND_NAME = "glorious";
export const DEFAULT_COMMAND_DESCRIPTION =
  "Interactive coding agent. Invocation opens a chat session.";

export interface GloriousCommandDependencies {
  version: string;
  /** The interactive chat session (the only command). */
  runChat(): Promise<number>;
  name?: string;
  description?: string;
  writers?: GloriousCliIo;
}

export interface GloriousCliIo {
  stdout?: Pick<typeof processStdout, "write">;
  stderr?: Pick<typeof processStderr, "write">;
}

const createChatCommand = (deps: GloriousCommandDependencies) =>
  command({
    name: deps.name ?? DEFAULT_COMMAND_NAME,
    version: deps.version,
    description: deps.description ?? DEFAULT_COMMAND_DESCRIPTION,
    args: {},
    handler: () => deps.runChat(),
  });

/** One argument or flag of a CLI command, as shown in `--help`. */
export interface CliArgDoc {
  usage: string;
  description: string;
}

/** A user-facing CLI command's documentable shape. */
export interface CliCommandDoc {
  name: string;
  description: string;
  args: CliArgDoc[];
  flags: CliArgDoc[];
}

/** cmd-ts commands expose their help rows through `helpTopics()`, which isn't in
 *  the published types; this is the slice we read. */
interface HelpTopic {
  category: string;
  usage: string;
  description: string;
}
interface Introspectable {
  name: string;
  description?: string;
  helpTopics(): HelpTopic[];
}

const describeCommand = (command: Introspectable): CliCommandDoc => {
  const rows = command.helpTopics();
  const inCategories = (categories: string[]): CliArgDoc[] =>
    rows
      // The auto-added help flag is noise in a reference table.
      .filter((row) => categories.includes(row.category) && !row.usage.startsWith("--help"))
      .map((row) => ({ usage: row.usage, description: row.description }));
  return {
    name: command.name,
    description: command.description ?? "",
    // Positionals are "arguments"; `--x` flags and `--x <value>` options both read
    // as flags in a reference (their usage string already shows any value).
    args: inCategories(["arguments"]),
    flags: inCategories(["flags", "options"]),
  };
};

/**
 * The user-facing command line, extracted from the same `command()` definitions
 * the parser runs — so docs and `--help` can never disagree. Handlers are never
 * invoked here (help extraction only reads structure), so no-op deps are safe.
 */
export function describeCli(): CliCommandDoc[] {
  const deps: GloriousCommandDependencies = {
    version: "",
    runChat: async () => EXIT_SUCCESS,
  };
  return [createChatCommand(deps)].map((command) =>
    describeCommand(command as unknown as Introspectable),
  );
}

const writeResult = (
  result: Awaited<ReturnType<typeof runSafely>>,
  writers: Required<GloriousCliIo>,
): number | undefined => {
  if (result._tag !== "error") {
    return undefined;
  }

  const { exitCode, into, message } = result.error.config;
  // cmd-ts messages (--help, --version) carry no trailing newline; writing
  // them verbatim leaves the shell prompt glued to the output.
  (into === "stdout" ? writers.stdout : writers.stderr).write(
    message.endsWith("\n") ? message : `${message}\n`,
  );
  return exitCode;
};

export async function runGloriousCli(
  argv: string[],
  deps: GloriousCommandDependencies,
  io: GloriousCliIo = {},
): Promise<number> {
  const writers: Required<GloriousCliIo> = {
    stdout: io.stdout ?? deps.writers?.stdout ?? processStdout,
    stderr: io.stderr ?? deps.writers?.stderr ?? processStderr,
  };

  const result = await runSafely(createChatCommand(deps), argv);
  if (result._tag === "error") return writeResult(result, writers) ?? EXIT_FAILURE;
  return await (result.value as Promise<number> | number);
}
