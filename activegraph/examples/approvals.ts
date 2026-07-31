/**
 * Reading parked commands back off the log.
 *
 * Approving a batch all-or-nothing is the wrong shape for a shell: when the
 * model proposes five commands and one is wrong, "no" throws away the four
 * that were fine. Each command parks two mutations — the object and the edge
 * that hangs it off the task — so choosing per command means granting them as
 * a pair, in the order they were proposed, since an edge cannot attach to an
 * object that does not exist yet.
 */

import type { AnyEvent } from "../domain/events";
import type { SchemaDef } from "../domain/schema";

export interface PendingCommand {
  /** Grant these in this order to release the command. */
  readonly approvalIds: readonly string[];
  readonly command: string;
  readonly description: string;
}

interface Proposed {
  readonly approvalId: string;
  readonly mutation: {
    readonly kind: string;
    readonly objectType?: string;
    readonly relationType?: string;
    readonly id?: string;
    readonly target?: string;
    readonly data?: { readonly command?: string; readonly description?: string };
  };
}

/**
 * Group still-pending approvals by the command they belong to, in proposal
 * order. An approval whose command object was already granted still appears,
 * so releasing a group never leaves half of it parked.
 */
export const pendingCommands = <S extends SchemaDef>(
  log: Iterable<AnyEvent<S>>,
  pending: readonly string[],
): readonly PendingCommand[] => {
  const waiting = new Set(pending);
  const groups = new Map<string, { ids: string[]; command: string; description: string }>();

  for (const event of log) {
    if ((event.type as string) !== "approval.proposed") continue;
    const { approvalId, mutation } = event.payload as Proposed;
    if (!waiting.has(approvalId)) continue;

    const key =
      mutation.kind === "addObject" && mutation.objectType === "command"
        ? mutation.id
        : mutation.kind === "addRelation" && mutation.relationType === "has_command"
          ? mutation.target
          : undefined;
    if (key === undefined) continue;

    const group = groups.get(key) ?? { ids: [], command: "", description: "" };
    group.ids.push(approvalId);
    if (mutation.data?.command !== undefined) {
      group.command = mutation.data.command;
      group.description = mutation.data.description ?? "";
    }
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    approvalIds: group.ids,
    // A group with no object proposal is one whose command already landed and
    // only its edge is parked; name it rather than showing an empty line.
    command: group.command === "" ? "(attach an already-approved command)" : group.command,
    description: group.description,
  }));
};
