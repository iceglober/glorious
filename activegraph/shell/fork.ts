/**
 * Fork and promote — branching a run at any historical event and landing a
 * fork's delta back on its parent.
 *
 * A fork is an O(1) overlay branch record (no events copied); a runtime
 * created on the fork branch rehydrates from the parent prefix and diverges
 * freely. `promote` is diff-then-propose: project the parent at the fork
 * base, project the fork head, `diffGraphs`, and run `diffToMutations`
 * through the PARENT runtime's ordinary validate/apply pipeline — so a parent
 * that moved on since the fork point surfaces conflicts as `patch.rejected`
 * (version_conflict) events instead of being silently clobbered.
 */

import { diffGraphs, diffToMutations, type GraphDiff } from "../domain/diff";
import { project } from "../domain/graph";
import type { EventId, SchemaDef } from "../domain/schema";
import { err, ok, type Result } from "../lib/fp";
import type { BranchRecord, EventStore, StoreError } from "../ports/event-store";
import type { Runtime, RuntimeError, RuntimeStatus } from "./runtime";

export const createFork = async <S extends SchemaDef>(options: {
  readonly store: EventStore<S>;
  readonly parent: string;
  readonly atEventId: EventId;
  readonly name: string;
}): Promise<Result<BranchRecord, StoreError>> => {
  const { store, parent, atEventId, name } = options;
  const head = await store.head(parent);
  if (!head.ok) return head;
  if (atEventId < 0 || atEventId > head.value) {
    return err({
      reason: "io_error",
      message: `fork point ${atEventId} is outside 0..${head.value}`,
    });
  }
  const record: BranchRecord = { name, parent, baseEventId: atEventId };
  const created = await store.createBranch(record);
  if (!created.ok) return created;
  return ok(record);
};

export type PromoteError =
  | { readonly reason: "store_error"; readonly error: StoreError }
  | { readonly reason: "unknown_fork"; readonly fork: string }
  | { readonly reason: "runtime_error"; readonly error: RuntimeError };

export interface PromoteResult<S extends SchemaDef> {
  readonly diff: GraphDiff<S>;
  readonly applied: number;
  readonly rejected: number;
  readonly status: RuntimeStatus;
}

/**
 * Apply the fork's delta to the parent runtime. The parent runtime must be
 * the one bound to the fork's parent branch; conflicts appear as
 * patch.rejected events in the returned counts (and the parent's log).
 */
export const promote = async <S extends SchemaDef>(options: {
  readonly schema: S;
  readonly store: EventStore<S>;
  readonly fork: string;
  readonly parentRuntime: Runtime<S>;
}): Promise<Result<PromoteResult<S>, PromoteError>> => {
  const { schema, store, fork, parentRuntime } = options;
  const record = await store.branch(fork);
  if (!record.ok) return err({ reason: "store_error", error: record.error });
  if (record.value === null || record.value.parent === null) {
    return err({ reason: "unknown_fork", fork });
  }
  const base = record.value.baseEventId ?? 0;

  const parentAtBase = await store.read({ branch: record.value.parent, toId: base });
  if (!parentAtBase.ok) return err({ reason: "store_error", error: parentAtBase.error });
  const forkHead = await store.read({ branch: fork });
  if (!forkHead.ok) return err({ reason: "store_error", error: forkHead.error });

  const diff = diffGraphs(project<S>(parentAtBase.value), project<S>(forkHead.value));
  const mutations = diffToMutations(schema, diff);
  const proposed = await parentRuntime.propose(mutations, { actor: `promote:${fork}` });
  if (!proposed.ok) return err({ reason: "runtime_error", error: proposed.error });

  const counts = proposed.value.appended.reduce(
    (acc, event) => {
      const type = event.type as string;
      return {
        applied: acc.applied + (type === "patch.applied" ? 1 : 0),
        rejected: acc.rejected + (type === "patch.rejected" ? 1 : 0),
      };
    },
    { applied: 0, rejected: 0 },
  );
  return ok({ diff, ...counts, status: proposed.value.status });
};
