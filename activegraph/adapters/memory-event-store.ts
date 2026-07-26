/**
 * In-memory EventStore — the default adapter and the reference semantics for
 * the shared store contract. Branches are overlays: a fork stores only its
 * own events plus a (parent, baseEventId) record; reads materialize the
 * parent prefix recursively. Appends enforce per-branch id contiguity so a
 * torn writer can't silently corrupt the sequence.
 */
import { err, ok } from "../lib/fp";
import type { AnyEvent } from "../domain/events";
import type { EventId, SchemaDef } from "../domain/schema";
import type { BranchRecord, EventStore, StoreError } from "../ports/event-store";

export const createMemoryEventStore = <S extends SchemaDef>(): EventStore<S> => {
  const branches = new Map<string, BranchRecord>();
  const own = new Map<string, AnyEvent<S>[]>();

  const materialized = (name: string): readonly AnyEvent<S>[] | StoreError => {
    const record = branches.get(name);
    if (record === undefined) return { reason: "unknown_branch", branch: name };
    const events = own.get(name) ?? [];
    if (record.parent === null) return events;
    const parent = materialized(record.parent);
    if (!Array.isArray(parent)) return parent as StoreError;
    const base = record.baseEventId ?? 0;
    return [...parent.filter((event) => event.id <= base), ...events];
  };

  const headOf = (name: string): EventId | StoreError => {
    const all = materialized(name);
    if (!Array.isArray(all)) return all as StoreError;
    return all.length === 0 ? 0 : (all[all.length - 1]?.id ?? 0);
  };

  return {
    append: async (events) => {
      for (const event of events) {
        const name = event.branch;
        if (!branches.has(name)) {
          // Roots materialize implicitly on first append; forks must be
          // created explicitly so their overlay base is known.
          branches.set(name, { name, parent: null, baseEventId: null });
          own.set(name, []);
        }
        const head = headOf(name);
        if (typeof head !== "number") return err(head);
        if (event.id !== head + 1) {
          return err({ reason: "id_gap", branch: name, expected: head + 1, got: event.id });
        }
        own.get(name)?.push(event);
      }
      return ok(undefined);
    },
    read: async ({ branch, fromId, toId }) => {
      const all = materialized(branch);
      if (!Array.isArray(all)) return err(all as StoreError);
      return ok(
        all.filter(
          (event) =>
            (fromId === undefined || event.id >= fromId) &&
            (toId === undefined || event.id <= toId),
        ),
      );
    },
    head: async (branch) => {
      const head = headOf(branch);
      return typeof head === "number" ? ok(head) : err(head);
    },
    createBranch: async (record) => {
      if (branches.has(record.name)) return err({ reason: "branch_exists", branch: record.name });
      if (record.parent !== null && !branches.has(record.parent)) {
        return err({ reason: "unknown_branch", branch: record.parent });
      }
      branches.set(record.name, record);
      own.set(record.name, []);
      return ok(undefined);
    },
    branch: async (name) => ok(branches.get(name) ?? null),
  };
};
