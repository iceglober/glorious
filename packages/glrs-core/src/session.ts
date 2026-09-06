import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { contextTokensOf, eventsFromMessages, type SessionEvent } from "./events";

// Sessions are plain JSON. They were AES-GCM encrypted under a key from the
// macOS Keychain, which bought little — the transcript is on the same disk as
// the repo it is about — and cost a Keychain prompt that has nowhere to go
// under a pty, so every driven run had to disable it first. With -p a headless
// run is a first-class path, and observability is the point: `cat` the file.
const store = (name: string): string =>
  join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), name, "sessions");

// Read per call rather than captured at import. XDG_DATA_HOME decides where
// these land, and a module-level constant meant the only way to point them
// somewhere disposable was to set the variable before this file was first
// imported — which is to say, untestable.
const directory = (): string => store("glrs");
// Where sessions were written before the rename. Read, never written: a session
// resumed from here is saved to the new directory, so the store migrates itself
// one session at a time and nothing has to be moved by hand. Listing dedupes by
// id with the new copy winning, or a half-migrated store would show every
// resumed session twice.
const legacy = (): string => store("glorious");
const promptFile = "prompts.json";

export const sessionFile = (id: string): string => {
  const current = join(directory(), `${id}.json`);
  if (existsSync(current)) return current;
  const before = join(legacy(), `${id}.json`);
  return existsSync(before) ? before : current;
};

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

/** Persisted conversation and usage state. */
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

const load = async (path: string): Promise<Session | null> => {
  try {
    const stored = JSON.parse(await readFile(path, "utf8")) as StoredSession | LegacySession;
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

const filesIn = async (dir: string): Promise<string[]> => {
  try {
    return (await readdir(dir))
      .filter((file) => file.endsWith(".json") && file !== promptFile)
      .map((file) => join(dir, file));
  } catch {
    return [];
  }
};

export const listSessions = async (): Promise<Session[]> => {
  // New directory first, so its copy is the one that survives the dedupe below.
  const paths = [...(await filesIn(directory())), ...(await filesIn(legacy()))];
  const sessions = await Promise.all(paths.map(load));
  const byId = new Map<string, Session>();
  for (const session of sessions) {
    if (session === null || byId.has(session.id)) continue;
    byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  await mkdir(directory(), { recursive: true });
  const { id, createdAt, updatedAt, cwd, events } = session;
  const contextTokens = session.contextTokens ?? contextTokensOf(events);
  await writeFile(
    join(directory(), `${id}.json`),
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
    const from = existsSync(join(directory(), promptFile)) ? directory() : legacy();
    const parsed = JSON.parse(await readFile(join(from, promptFile), "utf8")) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
};

/** Durable session operations required by an SDK host. */
export type SessionRepository = {
  create: (cwd: string) => Promise<Session>;
  load: (id: string) => Promise<Session | null>;
  list: () => Promise<Session[]>;
  append: (id: string, events: readonly SessionEvent[]) => Promise<void>;
  fork: (id: string, atEvent?: number) => Promise<Session>;
  save: (session: Session) => Promise<void>;
};

/** Plain-JSON session repository used by the glrs CLI. */
export const jsonSessionRepository: SessionRepository = {
  create: createSession,
  load: async (id) => (await listSessions()).find((session) => session.id === id) ?? null,
  list: listSessions,
  append: appendSessionEvents,
  fork: forkSession,
  save: saveSession,
};

export const savePromptHistory = async (prompts: string[]): Promise<void> => {
  await mkdir(directory(), { recursive: true });
  await writeFile(join(directory(), promptFile), `${JSON.stringify(prompts)}\n`, "utf8");
};

// ── compaction artifacts ─────────────────────────────────────────────────────
//
// What a compaction replaced, kept. The brief that goes into the conversation
// is lossy by design; the messages it stood in for are written here unchanged,
// so a session that later needs the exact error text or the path the brief
// paraphrased can read it back rather than reconstruct it. One file per
// compaction, beside the session that produced it, named by when it happened.

export type Artifact = {
  id: string;
  sessionId: string;
  createdAt: string;
  label: string;
  note: string;
  messages: number;
};

const artifactsDir = (sessionId: string): string => join(directory(), "artifacts", sessionId);

// A timestamp that is also a valid filename on every platform, which ISO 8601
// with its colons is not.
const artifactId = (at: Date): string => at.toISOString().replace(/[:.]/gu, "-");

const FRONT = "---";

// A message as a person would read it. Tool calls carry their input and tool
// results their output, because those are exactly the details a brief drops.
const renderMessage = (message: ModelMessage): string => {
  const { role, content } = message;
  if (typeof content === "string") return `[${role}]\n${content}`;
  const parts = (content as ReadonlyArray<Record<string, unknown>>).map((part) => {
    switch (part.type) {
      case "text":
        return String(part.text ?? "");
      case "reasoning":
        return `[reasoning]\n${String(part.text ?? "")}`;
      case "tool-call":
        return `[tool-call ${String(part.toolName ?? "")}]\n${JSON.stringify(part.input ?? {}, null, 2)}`;
      case "tool-result": {
        const output = part.output as { type?: string; value?: unknown } | undefined;
        const text =
          output?.type === "text" || output?.type === "error-text"
            ? String(output.value ?? "")
            : JSON.stringify(output?.value ?? output ?? null, null, 2);
        return `[tool-result ${String(part.toolName ?? "")}]\n${text}`;
      }
      default:
        return `[${String(part.type ?? "part")}]\n${JSON.stringify(part, null, 2)}`;
    }
  });
  return `[${role}]\n${parts.join("\n\n")}`;
};

const header = (artifact: Omit<Artifact, "sessionId" | "id">): string =>
  [
    FRONT,
    `label: ${artifact.label.replaceAll("\n", " ")}`,
    `createdAt: ${artifact.createdAt}`,
    `messages: ${artifact.messages}`,
    `note: ${artifact.note.replaceAll("\n", " ")}`,
    FRONT,
    "",
  ].join("\n");

const parseHeader = (
  text: string,
): { label: string; createdAt: string; messages: number; note: string; body: string } => {
  const lines = text.split("\n");
  const fields: Record<string, string> = {};
  let end = 0;
  if (lines[0] === FRONT) {
    for (let at = 1; at < lines.length; at += 1) {
      if (lines[at] === FRONT) {
        end = at + 1;
        break;
      }
      const colon = lines[at].indexOf(":");
      if (colon > 0) fields[lines[at].slice(0, colon).trim()] = lines[at].slice(colon + 1).trim();
    }
  }
  return {
    label: fields.label ?? "",
    createdAt: fields.createdAt ?? "",
    messages: Number(fields.messages ?? 0) || 0,
    note: fields.note ?? "",
    body: lines.slice(end).join("\n").replace(/^\n/u, ""),
  };
};

export const writeArtifact = async (
  sessionId: string,
  input: { label: string; messages: readonly ModelMessage[]; now?: Date },
): Promise<Artifact> => {
  const at = input.now ?? new Date();
  const artifact = {
    label: input.label.trim() || "compacted conversation",
    createdAt: at.toISOString(),
    messages: input.messages.length,
    note: "",
  };
  await mkdir(artifactsDir(sessionId), { recursive: true });
  const id = artifactId(at);
  await writeFile(
    join(artifactsDir(sessionId), `${id}.md`),
    header(artifact) + input.messages.map(renderMessage).join("\n\n") + "\n",
    "utf8",
  );
  return { id, sessionId, ...artifact };
};

export const listArtifacts = async (sessionId: string): Promise<Artifact[]> => {
  const dir = artifactsDir(sessionId);
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  const found: Artifact[] = [];
  for (const name of names) {
    const parsed = parseHeader(await readFile(join(dir, name), "utf8"));
    found.push({ id: name.slice(0, -3), sessionId, ...parsed, body: undefined } as Artifact);
  }
  return found;
};

export const readArtifact = async (sessionId: string, id: string): Promise<string | null> => {
  const path = join(artifactsDir(sessionId), `${id}.md`);
  if (!existsSync(path)) return null;
  return parseHeader(await readFile(path, "utf8")).body;
};

export const annotateArtifact = async (
  sessionId: string,
  id: string,
  change: { label?: string; note?: string },
): Promise<boolean> => {
  const path = join(artifactsDir(sessionId), `${id}.md`);
  if (!existsSync(path)) return false;
  const parsed = parseHeader(await readFile(path, "utf8"));
  const next = {
    label: change.label?.trim() || parsed.label,
    createdAt: parsed.createdAt,
    messages: parsed.messages,
    note: change.note === undefined ? parsed.note : change.note.trim(),
  };
  await writeFile(path, header(next) + parsed.body, "utf8");
  return true;
};

export const deleteArtifact = async (sessionId: string, id: string): Promise<boolean> => {
  const path = join(artifactsDir(sessionId), `${id}.md`);
  if (!existsSync(path)) return false;
  await rm(path);
  return true;
};
