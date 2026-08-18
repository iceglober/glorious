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

export const sessionFile = (id: string): string => join(directory, `${id}.json`);

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

export type Session = {
  schema: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  events: SessionEvent[];
  contextTokens?: number;
  title: string;
};

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

export const saveSession = async (session: Omit<Session, "title"> | Session): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const { id, createdAt, updatedAt, cwd, events } = session;
  const contextTokens = session.contextTokens ?? contextTokensOf(events);
  await writeFile(
    join(directory, `${id}.json`),
    `${JSON.stringify({ schema: 2, id, createdAt, updatedAt, cwd, events, contextTokens })}\n`,
    "utf8",
  );
};

export const appendSessionEvents = async (
  id: string,
  events: readonly SessionEvent[],
): Promise<void> => {
  const session = (await listSessions()).find((entry) => entry.id === id);
  if (!session) throw new Error(`Session not found: ${id}`);
  session.events.push(...events);
  session.updatedAt = new Date().toISOString();
  await saveSession(session);
};

export const forkSession = async (id: string, atEvent?: number): Promise<Session> => {
  const source = (await listSessions()).find((entry) => entry.id === id);
  if (!source) throw new Error(`Session not found: ${id}`);
  const now = new Date().toISOString();
  const events = source.events.slice(0, atEvent ?? source.events.length);
  const forked: StoredSession = {
    schema: 2,
    id: randomUUID().slice(0, 8),
    createdAt: now,
    updatedAt: now,
    cwd: source.cwd,
    events,
    contextTokens: contextTokensOf(events),
  };
  await saveSession(forked);
  return { ...forked, title: titleOf(events) };
};

export const loadPromptHistory = async (): Promise<string[]> => {
  try {
    const parsed = JSON.parse(await readFile(join(directory, promptFile), "utf8")) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
};

export type SessionRepository = {
  create: (cwd: string) => Promise<Session>;
  load: (id: string) => Promise<Session | null>;
  list: () => Promise<Session[]>;
  append: (id: string, events: readonly SessionEvent[]) => Promise<void>;
  fork: (id: string, atEvent?: number) => Promise<Session>;
  save: (session: Session) => Promise<void>;
};

export const jsonSessionRepository: SessionRepository = {
  create: createSession,
  load: async (id) => (await listSessions()).find((session) => session.id === id) ?? null,
  list: listSessions,
  append: appendSessionEvents,
  fork: forkSession,
  save: saveSession,
};

export const savePromptHistory = async (prompts: string[]): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, promptFile), `${JSON.stringify(prompts)}\n`, "utf8");
};
