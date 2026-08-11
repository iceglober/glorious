import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveMcp, isApproved, loadApprovals, mcpFingerprint } from "./approvals";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("approval is tied to the exact MCP definition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glorious-approvals-"));
  directories.push(directory);
  const path = join(directory, "approvals.json");
  const first = { command: "bun", args: ["server.ts"] };
  const approval = { root: "/repo", name: "server", fingerprint: mcpFingerprint(first) };

  await approveMcp(approval, path);
  const stored = await loadApprovals(path);

  expect(isApproved(stored, approval)).toBe(true);
  expect(
    isApproved(stored, {
      ...approval,
      fingerprint: mcpFingerprint({ command: "bun", args: ["other.ts"] }),
    }),
  ).toBe(false);
});
