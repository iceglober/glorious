import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { contextTokensOf, eventsFromMessages, type SessionEvent } from "./events";

// Sessions are plain JSON. They were AES-GCM encrypted under a key from the
// macOS Keychain, which bought little — the transcript is on the same disk as
// the repo it is about — and cost a Keychain prompt that has nowhere to go
// under a pty, so every driven run had to disable it first. With -p a headless
// run is a first-class path, and observability is the point: `cat` the file.
const directory = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "glorious",
  "sessions",
);
const promptFile = "prompts.json";

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

export type Session = StoredSession & { title: string };

const titleOf = (events: readonly SessionEvent[]): string => {
  const last = events.findLast((event) => event.type === "user");
  if (last?.type !== "user") return "New session";
  return last.text.replaceAll(/\s+/g, " ").trim().slice(0, 72) || "New session";
};

const load = async (file: string): Promise<Session | null> => {
  try {
    const stored = JSON.parse(await readFile(join(directory, file), "utf8")) as
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
    `${JSON.stringify({ schema: 2, id, createdAt, updatedAt, cwd, events, contextTokens })}\n`,
    "utf8",
  );
};

export const loadPromptHistory = async (): Promise<string[]> => {
  try {
    const parsed = JSON.parse(await readFile(join(directory, promptFile), "utf8")) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
};

export const savePromptHistory = async (prompts: string[]): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, promptFile), `${JSON.stringify(prompts)}\n`, "utf8");
};
