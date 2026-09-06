import type { Glrs } from "../../../glrs-core/src";
import {
  annotateArtifact,
  deleteArtifact,
  listArtifacts,
  readArtifact,
} from "../../../glrs-core/src/session";

// A compaction brief is lossy by design. The messages it replaced are kept on
// disk by the core, unchanged; these tools are how the agent reaches them when
// the brief turns out to have dropped the one detail it now needs. The core
// writes the files and knows nothing about tools; this extension knows the
// tools and nothing about compaction. Disable it and the files still land.

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;

export default function compactionArtifacts(g: Glrs): void {
  const session = (): string => g.session().id;

  const listing = async (): Promise<string> => {
    const found = await listArtifacts(session());
    if (found.length === 0) return "No compaction artifacts in this session.";
    return found
      .map(
        (one) =>
          `${one.id}  ${one.createdAt.slice(0, 16).replace("T", " ")}  ${one.messages} messages\n` +
          `  ${one.label}${one.note ? `\n  note: ${one.note}` : ""}`,
      )
      .join("\n");
  };

  g.tool({
    name: "compaction_list",
    description:
      "List what earlier compactions of this session replaced: one entry per compaction, newest last, each with its id, when it happened, how many messages it holds, and the brief that stood in for them. Use this when the conversation says something was compacted and you need a detail the brief did not keep.",
    input: g.z.object({}),
    execute: async () => listing(),
  });

  g.tool({
    name: "compaction_read",
    description:
      "Read the exact messages one compaction replaced, unchanged: user turns, your replies, tool calls with their input, tool results with their output. Large. Read one at a time and only for the detail you actually need.",
    input: g.z.object({
      id: g.z.string().describe("An id from compaction_list"),
    }),
    execute: async ({ id }) => {
      const body = await readArtifact(session(), id);
      return (
        body ?? `ERROR: no compaction artifact called ${id}. compaction_list shows what exists.`
      );
    },
  });

  g.tool({
    name: "compaction_annotate",
    description:
      "Relabel a compaction artifact or attach a note, so it is easier to find again. The label is what compaction_list shows; the note is free text.",
    input: g.z.object({
      id: g.z.string().describe("An id from compaction_list"),
      label: g.z.string().optional().describe("A new one-line label"),
      note: g.z.string().optional().describe("A note to keep with it, or an empty string to clear"),
    }),
    execute: async ({ id, label, note }) => {
      if (label === undefined && note === undefined)
        return "Nothing to change: give a label, a note, or both.";
      const changed = await annotateArtifact(session(), id, { label, note });
      return changed ? `Updated ${id}.` : `ERROR: no compaction artifact called ${id}.`;
    },
  });

  g.tool({
    name: "compaction_delete",
    description:
      "Delete a compaction artifact permanently. The brief in the conversation is unaffected; only the ability to read the original messages is lost. Do this only when the user asks or when the artifact is clearly obsolete.",
    input: g.z.object({
      id: g.z.string().describe("An id from compaction_list"),
    }),
    execute: async ({ id }) => {
      const removed = await deleteArtifact(session(), id);
      return removed ? `Deleted ${id}.` : `ERROR: no compaction artifact called ${id}.`;
    },
  });

  // Said only when there is something to say: a session that has never been
  // compacted should not carry a line about compaction on every turn. The
  // prompt hook is synchronous, so the count is kept rather than looked up,
  // refreshed when the session opens and each time a compaction lands.
  let kept = 0;
  const recount = async (): Promise<undefined> => {
    kept = (await listArtifacts(session()).catch(() => [])).length;
    return undefined;
  };
  g.on("session_start", recount);
  g.on("compact", recount);
  g.prompt(() =>
    kept === 0
      ? ""
      : `${kept} earlier compaction(s) of this session are kept in full. ` +
        "compaction_list names them; compaction_read gives the exact messages one replaced.",
  );

  g.command("artifacts", {
    description: "List what earlier compactions of this session replaced",
    run: async () => g.print(await listing()),
  });
}
