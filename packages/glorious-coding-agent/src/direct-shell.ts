import type { ShellResult } from "./tools";

export const cleanShellChunk = (text: string): string => {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
  return text.replace(ansi, "").replaceAll("\r", "\n");
};

export const shellCompletion = (
  result: ShellResult,
  hadOutput: boolean,
): { text: string; tone: "muted" | "danger" } | null => {
  if (result.code === 0)
    return hadOutput ? null : { text: "(shell command completed with no output)", tone: "muted" };
  const reason = result.output.split("\n").at(-1) || `exit ${result.code}`;
  return { text: `(shell command failed — ${reason})`, tone: "danger" };
};
