import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolError } from "../domain/effects";
import type { Result } from "../lib/fp";
import type { BashInput } from "./coding-agent";
import { createShellTool } from "./shell-tool";

const tool = createShellTool();
const limits = { timeoutMs: 5_000, maxOutputBytes: 1_000_000 };
const run = (input: Partial<BashInput> & { readonly command: string }) =>
  tool.execute("bash", { cwd: process.cwd(), ...limits, ...input });

const messageOf = (result: Result<unknown, ToolError>): string =>
  result.ok ? "" : "message" in result.error ? result.error.message : result.error.reason;

describe("shell tool", () => {
  test("runs the command in the requested directory, not the process's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shell-tool-"));
    writeFileSync(join(dir, "marker.txt"), "found me\n");

    const result = await run({ command: "cat marker.txt", cwd: dir });

    expect(result).toEqual({ ok: true, value: "found me" });
    // The same command from the process's own directory cannot see the file.
    expect((await run({ command: "cat marker.txt" })).ok).toBe(false);
  });

  test("a non-zero exit becomes a tool error carrying the output", async () => {
    const result = await run({ command: "echo nope >&2; exit 3" });

    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain("nope");
  });

  test("a command that outruns its timeout is killed", async () => {
    const started = Bun.nanoseconds();
    const result = await run({ command: "sleep 10", timeoutMs: 250 });
    const elapsedMs = (Bun.nanoseconds() - started) / 1_000_000;

    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain("Killed by SIG");
    expect(elapsedMs).toBeLessThan(5_000);
  });

  test("a command that floods its output ceiling is killed", async () => {
    const result = await run({ command: "yes flooding", maxOutputBytes: 2_000 });

    expect(result.ok).toBe(false);
    expect(messageOf(result)).toContain("Killed by SIG");
  });

  test("secret-shaped values are masked wherever they surface", async () => {
    const secret = "sk-fake-abcdef0123456789";
    const masking = createShellTool({
      environment: {
        DEMO_API_KEY: secret,
        DEMO_PROJECT: "public-value-not-a-secret",
        DEMO_TOKEN: "short",
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "shell-tool-"));
    writeFileSync(
      join(dir, ".env"),
      `DEMO_API_KEY=${secret}\nDEMO_PROJECT=public-value-not-a-secret\n`,
    );

    // The classic leak: reading the very file the runner loaded.
    const read = await masking.execute("bash", {
      command: "cat .env",
      cwd: dir,
      ...limits,
    });
    expect(read.ok).toBe(true);
    expect(read.ok ? read.value : "").not.toContain(secret);
    expect(read.ok ? read.value : "").toContain("DEMO_API_KEY=[redacted]");
    // Values that are not secret-shaped stay readable.
    expect(read.ok ? read.value : "").toContain("public-value-not-a-secret");

    // Failure paths carry output too, so they are redacted as well.
    const failed = await masking.execute("bash", {
      command: `echo ${secret} >&2; exit 1`,
      cwd: dir,
      ...limits,
    });
    expect(messageOf(failed)).not.toContain(secret);
    expect(messageOf(failed)).toContain("[redacted]");

    // Too short to mask without mangling ordinary output.
    const shortValue = await masking.execute("bash", {
      command: "echo short",
      cwd: dir,
      ...limits,
    });
    expect(shortValue).toEqual({ ok: true, value: "short" });

    // Control: with nothing to redact the same read returns the value intact,
    // so the assertions above are the masking working rather than an accident.
    const plain = createShellTool({ environment: {} });
    const unmasked = await plain.execute("bash", { command: "cat .env", cwd: dir, ...limits });
    expect(unmasked.ok ? unmasked.value : "").toContain(secret);
  });

  test("destructive patterns are refused before a shell sees them", async () => {
    const result = await run({ command: "rm -rf /tmp/definitely-not-real" });

    expect(result).toEqual({
      ok: false,
      error: { reason: "tool_error", message: "Blocked potentially destructive command" },
    });
  });
});
