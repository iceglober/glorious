/**
 * EventStore — the persistence boundary for the append-only log. Implemented
 * by adapters (memory, bun:sqlite); the domain never sees this interface, and
 * the shell only calls it, never interprets storage details.
 *
 * Branch semantics are OVERLAYS, not copies: a fork records (parent,
 * baseEventId) and `read(fork)` returns the parent's events with id ≤ base
 * followed by the fork's own, ids contiguous within each branch view. That is
 * what makes forking O(1) and lets `project` and strict replay run unchanged
 * on forks. Chained forks overlay recursively.
 */
import type { Result } from "../lib/fp";
import type { AnyEvent } from "../domain/events";
import type { EventId, SchemaDef } from "../domain/schema";

export interface BranchRecord {
  readonly name: string;
  readonly parent: string | null;
  /** Fork point in the parent; null for the root branch. */
  readonly baseEventId: EventId | null;
}

export type StoreError =
  | { readonly reason: "io_error"; readonly message: string }
  | { readonly reason: "unknown_branch"; readonly branch: string }
  | { readonly reason: "branch_exists"; readonly branch: string }
  | { readonly reason: "id_gap"; readonly branch: string; readonly expected: EventId; readonly got: EventId };

export interface EventStore<S extends SchemaDef> {
  /** Events must continue the branch's contiguous id sequence. */
  readonly append: (events: readonly AnyEvent<S>[]) => Promise<Result<void, StoreError>>;
  /** Overlay read: parent events with id ≤ baseEventId, then own. */
  readonly read: (options: {
    readonly branch: string;
    readonly fromId?: EventId;
    readonly toId?: EventId;
  }) => Promise<Result<readonly AnyEvent<S>[], StoreError>>;
  /** Highest event id visible on the branch (0 when empty). */
  readonly head: (branch: string) => Promise<Result<EventId, StoreError>>;
  readonly createBranch: (record: BranchRecord) => Promise<Result<void, StoreError>>;
  readonly branch: (name: string) => Promise<Result<BranchRecord | null, StoreError>>;
}
