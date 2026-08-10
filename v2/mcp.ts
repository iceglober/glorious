import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { jsonSchema, type ToolSet, tool } from "ai";
import { BUILT_IN_TOOL_NAMES, nextToolEventId, type ToolEvent } from "./tools";

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_MS = 45_000;
const RESULT_LIMIT = 30_000;

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
  // Names safe to keep in a read-only mode. There is no way to tell from the
  // outside whether a server's tool mutates, so anything not listed here is
  // withheld rather than guessed at.
  readOnly?: string[];
  disabled?: boolean;
};

export type McpToolSummary = {
  name: string;
  server: string;
  description: string;
  readOnly: boolean;
};
export type McpServerSummary = { name: string; tools: number };

export type McpSession = {
  toolsFor: (onEvent: (event: ToolEvent) => void) => ToolSet;
  summaries: readonly McpToolSummary[];
  servers: readonly McpServerSummary[];
  notes: readonly string[];
  loadSkillServers: (skill: string, servers: Record<string, McpServerConfig>) => Promise<void>;
  reload: () => Promise<void>;
  close: () => void;
};

type Listed = { name: string; description?: string; inputSchema?: Record<string, unknown> };

const capText = (text: string, limit: number): string =>
  text.length > limit
    ? `${text.slice(0, limit)}\n[truncated, ${text.length - limit} chars omitted]`
    : text;

const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? "";

export const readMcpConfig = async (root: string): Promise<Record<string, McpServerConfig>> => {
  const merged: Record<string, McpServerConfig> = {};
  for (const path of [
    join(homedir(), ".glorious", "mcp.json"),
    join(root, ".glorious", "mcp.json"),
  ]) {
    const parsed = await readFile(path, "utf8")
      .then((text) => JSON.parse(text) as { mcpServers?: Record<string, McpServerConfig> })
      .catch(() => null);
    for (const [name, server] of Object.entries(parsed?.mcpServers ?? {}))
      if (server && typeof server.command === "string") merged[name] = server;
  }
  return merged;
};

const connect = (name: string, config: McpServerConfig, root: string) => {
  const child = Bun.spawn([config.command, ...(config.args ?? [])], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, ...config.env },
  });

  const pending = new Map<
    number,
    { settle: (value: unknown) => void; fail: (reason: Error) => void; timer: Timer }
  >();
  let seq = 0;
  let closed = false;

  const dispatch = (message: Record<string, unknown>): void => {
    const id = message.id;
    if (typeof id !== "number") return;
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    clearTimeout(waiting.timer);
    const failure = message.error as { message?: string } | undefined;
    if (failure) waiting.fail(new Error(failure.message ?? `${name}: request failed`));
    else waiting.settle(message.result);
  };

  void (async () => {
    const utf8 = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of child.stdout as unknown as AsyncIterable<Uint8Array>) {
        buffer += utf8.decode(chunk, { stream: true });
        let at = buffer.indexOf("\n");
        while (at >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (line !== "") {
            try {
              dispatch(JSON.parse(line) as Record<string, unknown>);
            } catch {}
          }
          at = buffer.indexOf("\n");
        }
      }
    } catch {}
    closed = true;
    for (const [id, waiting] of pending) {
      pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.fail(new Error(`${name}: server closed the connection`));
    }
  })();

  const send = (payload: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.flush();
  };

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (closed) return Promise.reject(new Error(`${name}: server is not running`));
    seq += 1;
    const id = seq;
    return new Promise((settle, fail) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`${name}: ${method} timed out after ${REQUEST_MS / 1000}s`));
      }, REQUEST_MS);
      pending.set(id, { settle, fail, timer });
      send({ jsonrpc: "2.0", id, method, params });
    });
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const [id, waiting] of pending) {
      pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.fail(new Error(`${name}: shutting down`));
    }
    try {
      child.kill();
    } catch {}
  };

  const start = async (): Promise<Listed[]> => {
    await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "glorious", version: "1" },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    const listed = (await request("tools/list", {})) as { tools?: Listed[] };
    return listed?.tools ?? [];
  };

  return { request, close, start };
};

const resultText = (result: unknown): string => {
  const shaped = result as
    | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
    | undefined;
  const text = (shaped?.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
  const body = text === "" ? "[no output]" : text;
  return shaped?.isError ? `ERROR: ${body}` : body;
};

export const startMcp = async (
  root: string,
  servers: Record<string, McpServerConfig>,
): Promise<McpSession> => {
  const adopted: Array<{
    entry: Listed & { description: string };
    call: (args: Record<string, unknown>) => Promise<string>;
  }> = [];
  const summaries: McpToolSummary[] = [];
  const serversShown: McpServerSummary[] = [];
  const notes: string[] = [];
  const shutdowns: Array<() => void> = [];
  const taken = new Set<string>(BUILT_IN_TOOL_NAMES);
  const loadedSkills = new Map<string, Record<string, McpServerConfig>>();

  const load = async (configured: Record<string, McpServerConfig>): Promise<void> => {
    for (const [name, config] of Object.entries(configured)) {
      if (config.disabled) continue;
      const client = connect(name, config, root);
      shutdowns.push(client.close);
      const listed = await client.start().catch((thrown: unknown) => {
        notes.push(`${name}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
        client.close();
        return null;
      });
      if (listed === null) continue;

      const allowed = config.tools;
      const admitted = listed
        .filter((entry) => typeof entry?.name === "string")
        .filter((entry) => allowed === undefined || allowed.includes(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      let adoptedCount = 0;

      if (allowed !== undefined) {
        const missing = allowed.filter((want) => !listed.some((entry) => entry.name === want));
        if (missing.length > 0) notes.push(`${name}: not offered — ${missing.join(", ")}`);
      }

      for (const entry of admitted) {
        if (taken.has(entry.name)) {
          notes.push(`${name}: ${entry.name} shadowed by a built-in, skipped`);
          continue;
        }
        taken.add(entry.name);
        adoptedCount += 1;
        const description = entry.description ?? `${entry.name} (via ${name})`;
        summaries.push({
          name: entry.name,
          server: name,
          description: firstLine(description),
          readOnly: config.readOnly?.includes(entry.name) ?? false,
        });
        adopted.push({
          entry: { ...entry, description },
          call: (args: Record<string, unknown>) =>
            client
              .request("tools/call", { name: entry.name, arguments: args })
              .then(resultText)
              .catch(
                (thrown: unknown) =>
                  `ERROR: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
              ),
        });
      }
      serversShown.push({ name, tools: adoptedCount });
    }
  };

  await load(servers);

  const loadSkillServers = async (
    skill: string,
    configured: Record<string, McpServerConfig>,
  ): Promise<void> => {
    if (loadedSkills.has(skill)) return;
    loadedSkills.set(skill, configured);
    await load(
      Object.fromEntries(
        Object.entries(configured).filter(([name]) => !Object.hasOwn(servers, name)),
      ),
    );
  };

  const reload = async (): Promise<void> => {
    for (const stop of shutdowns.splice(0)) stop();
    adopted.splice(0);
    summaries.splice(0);
    serversShown.splice(0);
    notes.splice(0);
    taken.clear();
    for (const name of BUILT_IN_TOOL_NAMES) taken.add(name);
    await load(servers);
    for (const configured of loadedSkills.values()) await load(configured);
  };

  // Built per turn, like createTools, so events reach the turn's own sink and
  // MCP calls travel the same path to the transcript as the built-ins.
  const toolsFor = (onEvent: (event: ToolEvent) => void): ToolSet => {
    const built: ToolSet = {};
    for (const { entry, call } of adopted) {
      built[entry.name] = tool({
        description: entry.description,
        inputSchema: jsonSchema(
          (entry.inputSchema as Parameters<typeof jsonSchema>[0]) ?? {
            type: "object",
            properties: {},
          },
        ),
        execute: async (input: unknown) => {
          const raw = (input ?? {}) as Record<string, unknown>;
          const detail = String(
            raw.name_path ?? raw.relative_path ?? raw.name ?? raw.pattern ?? "",
          );
          const step = { id: nextToolEventId(), name: entry.name, detail };
          try {
            onEvent({ ...step, phase: "start" });
          } catch {}
          const result = capText(await call(raw), RESULT_LIMIT);
          try {
            onEvent({ ...step, phase: "end", ok: !result.startsWith("ERROR:") });
          } catch {}
          return result;
        },
      });
    }
    return built;
  };

  return {
    toolsFor,
    summaries,
    servers: serversShown,
    notes,
    loadSkillServers,
    reload,
    close: () => {
      for (const stop of shutdowns) stop();
    },
  };
};
