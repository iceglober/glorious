import { execFile as execFileCallback } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ModelMessage } from "ai";
import { contextTokensOf, eventsFromMessages, type SessionEvent } from "./events";

const execFile = promisify(execFileCallback);
const directory = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "glorious",
  "sessions",
);
const promptFile = "prompts.json";
const keychainService = "glorious-session-encryption";
const encryptionDisabled = /^(0|false|off)$/iu.test(process.env.GLORIOUS_SESSION_ENCRYPTION ?? "");
const algorithm = "aes-256-gcm";

type StoredSession = {
  schema: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  events: SessionEvent[];
  contextTokens?: number;
};

type LegacySession = Omit<StoredSession, "schema" | "events"> & {
  schema?: undefined;
  messages: ModelMessage[];
};

type EncryptedSession = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

export type Session = StoredSession & { title: string };

let key: Promise<Buffer> | undefined;

const keychainKey = (): Promise<Buffer> => {
  if (process.platform !== "darwin")
    throw new Error("Encrypted sessions currently require the macOS Keychain.");
  if (key) return key;
  key = (async () => {
    const account = process.env.USER ?? process.env.USERNAME ?? "default";
    try {
      const result = await execFile("security", [
        "find-generic-password",
        "-a",
        account,
        "-s",
        keychainService,
        "-w",
      ]);
      const stored = Buffer.from(result.stdout.trim(), "base64");
      if (stored.length === 32) return stored;
    } catch {}
    const created = randomBytes(32);
    await execFile("security", [
      "add-generic-password",
      "-U",
      "-a",
      account,
      "-s",
      keychainService,
      "-w",
      created.toString("base64"),
    ]);
    return created;
  })().catch((thrown) => {
    key = undefined;
    throw new Error(
      `Unable to access the macOS Keychain: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
  });
  return key;
};

const encode = async (value: unknown): Promise<string> => {
  if (encryptionDisabled) return `${JSON.stringify(value)}\n`;
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, await keychainKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope: EncryptedSession = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return `${JSON.stringify(envelope)}\n`;
};

const decode = async (text: string): Promise<unknown> => {
  const parsed = JSON.parse(text) as Partial<EncryptedSession> & Partial<StoredSession>;
  if (
    parsed.version !== 1 ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.data !== "string"
  )
    return parsed;
  const decipher = createDecipheriv(
    algorithm,
    await keychainKey(),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString(
      "utf8",
    ),
  );
};

const titleOf = (events: readonly SessionEvent[]): string => {
  const last = events.findLast((event) => event.type === "user");
  if (last?.type !== "user") return "New session";
  return last.text.replaceAll(/\s+/g, " ").trim().slice(0, 72) || "New session";
};

const load = async (file: string): Promise<Session | null> => {
  try {
    const stored = (await decode(await readFile(join(directory, file), "utf8"))) as
      | StoredSession
      | LegacySession;
    if (
      typeof stored.id !== "string" ||
      typeof stored.createdAt !== "string" ||
      typeof stored.updatedAt !== "string" ||
      typeof stored.cwd !== "string" ||
      (stored.contextTokens !== undefined && typeof stored.contextTokens !== "number")
    )
      return null;
    const migrated: StoredSession =
      stored.schema === 2
        ? stored
        : {
            ...stored,
            schema: 2,
            events: eventsFromMessages(stored.messages ?? []),
            contextTokens: stored.contextTokens,
          };
    if (!Array.isArray(migrated.events)) return null;
    return { ...migrated, title: titleOf(migrated.events) };
  } catch {
    return null;
  }
};

export const listSessions = async (): Promise<Session[]> => {
  let files: string[];
  try {
    files = (await readdir(directory)).filter(
      (file) => file.endsWith(".json") && file !== promptFile,
    );
  } catch {
    return [];
  }
  const sessions = await Promise.all(files.map(load));
  return sessions
    .filter((session): session is Session => session !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const openSession = async (
  id: string | undefined,
  pick: (sessions: Session[]) => Promise<Session>,
): Promise<Session> => {
  const sessions = await listSessions();
  if (id) {
    const session = sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }
  if (sessions.length === 0) throw new Error("No sessions to resume.");
  return pick(sessions);
};

export const createSession = async (cwd: string): Promise<Session> => {
  const now = new Date().toISOString();
  const session: StoredSession = {
    schema: 2,
    id: randomUUID().slice(0, 8),
    createdAt: now,
    updatedAt: now,
    cwd,
    events: [],
    contextTokens: 0,
  };
  await saveSession(session);
  return { ...session, title: titleOf(session.events) };
};

export const saveSession = async (session: StoredSession): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const { id, createdAt, updatedAt, cwd, events } = session;
  const contextTokens = session.contextTokens ?? contextTokensOf(events);
  await writeFile(
    join(directory, `${id}.json`),
    await encode({ schema: 2, id, createdAt, updatedAt, cwd, events, contextTokens }),
    "utf8",
  );
};

export const loadPromptHistory = async (): Promise<string[]> => {
  try {
    const parsed = await decode(await readFile(join(directory, promptFile), "utf8"));
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
};

export const savePromptHistory = async (prompts: string[]): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, promptFile), await encode(prompts), "utf8");
};
