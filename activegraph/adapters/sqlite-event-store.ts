/**
 * bun:sqlite EventStore — durable log persistence. The ONLY module in the
 * library that imports a runtime-specific API (`bun:sqlite`); everything it
 * stores is the event's canonical-friendly JSON body, so a log written here
 * and one written by the memory adapter are byte-identical in canonical form
 * (the cross-store determinism test asserts exactly that).
 *
 * Schema:
 *   branches(name TEXT PK, parent TEXT NULL, base_event_id INTEGER NULL)
 *   events(branch TEXT, id INTEGER, type TEXT, body TEXT, PK(branch, id))
 *
 * Reads materialize fork overlays recursively from branch records, same
 * semantics as the memory adapter (the shared contract suite runs on both).
 */
import { Database } from "bun:sqlite";
import type { AnyEvent } from "../domain/events";
import type { EventId, SchemaDef } from "../domain/schema";
import { andThen, err, mapResult, ok, type Result } from "../lib/fp";
import type { BranchRecord, EventStore, StoreError } from "../ports/event-store";

export const createSqliteEventStore = <S extends SchemaDef>(
  path = ":memory:",
): EventStore<S> & { readonly close: () => void } => {
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS branches (
      name TEXT PRIMARY KEY,
      parent TEXT,
      base_event_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      branch TEXT NOT NULL,
      id INTEGER NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (branch, id)
    );
  `);

  const getBranch = db.prepare<
    { name: string; parent: string | null; base_event_id: number | null },
    [string]
  >("SELECT name, parent, base_event_id FROM branches WHERE name = ?");
  const insertBranch = db.prepare(
    "INSERT INTO branches (name, parent, base_event_id) VALUES (?, ?, ?)",
  );
  const insertEvent = db.prepare("INSERT INTO events (branch, id, type, body) VALUES (?, ?, ?, ?)");
  const ownEvents = db.prepare<{ body: string }, [string]>(
    "SELECT body FROM events WHERE branch = ? ORDER BY id",
  );
  const ownHead = db.prepare<{ head: number | null }, [string]>(
    "SELECT MAX(id) AS head FROM events WHERE branch = ?",
  );

  const branchRecord = (name: string): BranchRecord | null => {
    const row = getBranch.get(name);
    return row === null
      ? null
      : { name: row.name, parent: row.parent, baseEventId: row.base_event_id };
  };

  const materialized = (name: string): Result<readonly AnyEvent<S>[], StoreError> => {
    const record = branchRecord(name);
    if (record === null) return err({ reason: "unknown_branch", branch: name });
    const events = ownEvents.all(name).map((row) => JSON.parse(row.body) as AnyEvent<S>);
    if (record.parent === null) return ok(events);
    const base = record.baseEventId ?? 0;
    return mapResult(materialized(record.parent), (parent) => [
      ...parent.filter((event) => event.id <= base),
      ...events,
    ]);
  };

  const headOf = (name: string): Result<EventId, StoreError> => {
    const record = branchRecord(name);
    if (record === null) return err({ reason: "unknown_branch", branch: name });
    const head = ownHead.get(name)?.head;
    if (head !== null && head !== undefined) return ok(head);
    if (record.parent === null) return ok(0);
    return ok(record.baseEventId ?? 0);
  };

  return {
    append: async (events) => {
      try {
        for (const event of events) {
          const name = event.branch;
          if (branchRecord(name) === null) insertBranch.run(name, null, null);
          const head = headOf(name);
          if (!head.ok) return head;
          if (event.id !== head.value + 1) {
            return err({ reason: "id_gap", branch: name, expected: head.value + 1, got: event.id });
          }
          insertEvent.run(name, event.id, event.type, JSON.stringify(event));
        }
        return ok(undefined);
      } catch (cause) {
        return err({ reason: "io_error", message: String(cause) });
      }
    },
    read: async ({ branch, fromId, toId }) =>
      andThen(materialized(branch), (all) =>
        ok(
          all.filter(
            (event) =>
              (fromId === undefined || event.id >= fromId) &&
              (toId === undefined || event.id <= toId),
          ),
        ),
      ),
    head: async (branch) => headOf(branch),
    createBranch: async (record) => {
      if (branchRecord(record.name) !== null) {
        return err({ reason: "branch_exists", branch: record.name });
      }
      if (record.parent !== null && branchRecord(record.parent) === null) {
        return err({ reason: "unknown_branch", branch: record.parent });
      }
      insertBranch.run(record.name, record.parent, record.baseEventId);
      return ok(undefined);
    },
    branch: async (name) => ok(branchRecord(name)),
    close: () => db.close(),
  };
};
