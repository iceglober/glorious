import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServerConfig } from "./mcp";

export type McpApproval = { root: string; name: string; fingerprint: string };

type StoredApprovals = { approvals: McpApproval[] };

export const approvalPath = (): string =>
  join(homedir(), ".config", "glorious", "mcp-approvals.json");

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

export const mcpFingerprint = (config: McpServerConfig): string =>
  createHash("sha256").update(stable(config)).digest("hex");

export const loadApprovals = async (path = approvalPath()): Promise<StoredApprovals> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoredApprovals>;
    return {
      approvals: Array.isArray(parsed.approvals)
        ? parsed.approvals.filter(
            (item): item is McpApproval =>
              typeof item?.root === "string" &&
              typeof item?.name === "string" &&
              typeof item?.fingerprint === "string",
          )
        : [],
    };
  } catch {
    return { approvals: [] };
  }
};

export const isApproved = (approvals: StoredApprovals, approval: McpApproval): boolean =>
  approvals.approvals.some(
    (item) =>
      item.root === approval.root &&
      item.name === approval.name &&
      item.fingerprint === approval.fingerprint,
  );

export const approveMcp = async (approval: McpApproval, path = approvalPath()): Promise<void> => {
  const stored = await loadApprovals(path);
  if (!isApproved(stored, approval)) stored.approvals.push(approval);
  const directory = dirname(path);
  const temporary = join(directory, `.mcp-approvals-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};
