import type { FirstPartyExtension } from "./extensions";

// What the model is told about capabilities it does not have but could.
//
// This rides the per-turn `<extensions>` block, never the system prompt. The
// system prompt has to stay byte-identical or the provider's cache misses on
// every turn; the per-turn message is new each turn anyway, so a line that
// changes between turns costs nothing and the messages already in history keep
// their cached prefix. `PREAMBLE_TAGS` already lists "extensions", so this is
// stripped from a replayed transcript without another tag being added.
//
// It says nothing at all once every first-party extension has been decided, which
// is the point: an agent that keeps offering something you already said no to
// is worse than one that never offered.

export const availableLines = (
  firstParty: readonly FirstPartyExtension[],
  canRecord: boolean,
): readonly string[] => {
  const undecided = firstParty.filter((one) => one.state === "undecided");
  if (undecided.length === 0) return [];
  return [
    "Not loaded, but available to turn on if the work calls for one:",
    ...undecided.map((one) => `- ${one.name}: ${one.summary}`),
    canRecord
      ? // The tool is what stops the offer repeating. Without recording the
        // answer somewhere durable, a decline lasts until the next turn.
        "Suggest one only when the task actually needs it. If the user agrees or " +
        "declines, call configure_extension to record the answer so it is not raised again."
      : "Suggest one only when the task actually needs it. To turn one on, the user adds " +
        "it to `extensions.load` in .glrs/config.json. glrs cannot write that file " +
        'unless "extensions" is listed in agentConfigAllowlist.',
  ];
};
