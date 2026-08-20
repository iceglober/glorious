import { describe, expect, test } from "bun:test";
import { cleanShellChunk, shellCompletion } from "./direct-shell";

describe("direct shell feedback", () => {
  test("a successful silent command says that it completed", () => {
    expect(
      shellCompletion({ output: "", stdout: "", stderr: "", code: 0, ok: true }, false),
    ).toEqual({ text: "(shell command completed with no output)", tone: "muted" });
  });

  test("a successful command with output needs no second completion message", () => {
    expect(
      shellCompletion({ output: "done", stdout: "done", stderr: "", code: 0, ok: true }, true),
    ).toBeNull();
  });

  test("a failed command reports its final reason", () => {
    expect(
      shellCompletion(
        { output: "trace\n[exit 1]", stdout: "", stderr: "trace", code: 1, ok: false },
        true,
      ),
    ).toEqual({ text: "(shell command failed: [exit 1])", tone: "danger" });
  });

  test("terminal color and carriage-return controls do not leak into the transcript", () => {
    const ansiEscape = String.fromCharCode(27);
    expect(cleanShellChunk(`${ansiEscape}[31merror${ansiEscape}[0m\rnext`)).toBe("error\nnext");
  });
});
