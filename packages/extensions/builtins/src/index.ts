import type { Glrs, Line } from "../../../glrs-core/src";

// Every slash command glrs ships. None of them are built in — the core
// registers no commands at all, and these arrive through exactly the API a
// third party writes against. That is the test: if /help could not be written
// as an extension, "extensible" would be a claim rather than a fact.
//
// Shadow any of them with your own .glrs/extensions/builtins.ts, or delete
// the lot and write your own. Nothing in the core depends on them existing.
//
// They print into the transcript rather than opening a panel over it. A listing
// you can scroll back to, copy out of, and read beside the work that prompted it
// beats one that takes the screen and has to be dismissed.

const NAME_MAX = 28;
const TAG_MAX = 10;

type Row = { name: string; tag?: string; note: string };

// One aligned block. The eye reads down the names, so they get a column of
// their own; descriptions are clipped to what is left rather than wrapped,
// because a listing that reflows is a listing you cannot skim.
const table = (g: Glrs, rows: readonly Row[]): Line[] => {
  const width = Math.max(40, g.columns() - 2);
  const nameCol = Math.min(NAME_MAX, Math.max(...rows.map((row) => row.name.length)));
  const tagCol = rows.some((row) => row.tag)
    ? Math.min(TAG_MAX, Math.max(...rows.map((row) => row.tag?.length ?? 0)))
    : 0;
  const noteCol = Math.max(12, width - nameCol - tagCol - 6);
  return rows.map((row): Line => {
    const name = g.clip(row.name, nameCol).padEnd(nameCol);
    const tag = tagCol === 0 ? "" : `  ${g.clip(row.tag ?? "", tagCol).padEnd(tagCol)}`;
    return [
      { text: "  " },
      { text: name, tone: "highlight", bold: true },
      ...(tagCol === 0 ? [] : [{ text: tag, tone: "muted" as const }]),
      { text: `  ${g.clip(row.note, noteCol)}`, tone: "muted" },
    ];
  });
};

// A heading with the hint that belongs to it pushed to the right margin, so the
// heading reads as a heading and the hint stays out of the way.
const heading = (g: Glrs, title: string, hint = ""): Line => {
  const room = Math.max(0, g.columns() - 2 - title.length - hint.length - 2);
  return [
    { text: title, tone: "accent", bold: true },
    ...(hint === "" ? [] : [{ text: `${" ".repeat(room)}  ${hint}`, tone: "muted" as const }]),
  ];
};

const blank: Line = [{ text: "" }];

// Where something came from, in a word. The absolute path was accurate and
// unreadable: three of them turned a five-line listing into fifteen, and the
// part that actually matters is whether this is yours, the project's, or
// glrs's own.
const originOf = (g: Glrs, path: string): string => {
  if (path.includes("/v2/bundled/")) return "bundled";
  if (path.startsWith(g.root)) return "project";
  // Spelled out rather than defaulting HOME to a sentinel. It defaulted to a
  // NUL byte — chosen because nothing starts with one — which made this whole
  // file binary to ripgrep, so every search of it silently found nothing.
  const home = process.env.HOME;
  if (home !== undefined && home !== "" && path.startsWith(home)) return "personal";
  return "other";
};

export default function builtins(g: Glrs): void {
  g.command("help", {
    description: "Show commands and keys",
    run: () => {
      const { commands } = g.inspect();
      g.print([
        heading(g, "Commands", "/ to complete · ↑↓ to move · Tab to fill"),
        ...table(
          g,
          commands.map((command) => ({ name: `/${command.name}`, note: command.description })),
        ),
        blank,
        heading(g, "Keys"),
        ...table(g, [
          {
            name: "Esc",
            note: "interrupt the turn · with none running, take back the newest queued message",
          },
          { name: "Ctrl+C", note: "clear the composer · interrupt · again to quit" },
          { name: "!", note: "run the rest of the line as a shell command" },
          {
            name: "@",
            note: "reference a file or directory — its contents, or its listing, travel with the message",
          },
        ]),
      ]);
    },
  });

  g.command("skills", {
    description: "List available skills",
    run: () => {
      const { skills } = g.inspect();
      if (skills.length === 0) return g.print("No skills found.");
      g.print([
        heading(
          g,
          "Skills",
          `${skills.length} loaded · ${skills.filter((skill) => skill.modelInvocable).length} offered to the model`,
        ),
        ...table(
          g,
          skills.map((skill) => ({
            name: `/${skill.command}`,
            // A skill the model cannot see is a different thing from one it can,
            // and the listing is where that has to be visible — otherwise the
            // only way to find out is that it never gets used.
            tag: skill.modelInvocable ? originOf(g, skill.location) : "you only",
            note: skill.description,
          })),
        ),
      ]);
    },
  });

  g.command("extensions", {
    description: "List loaded extensions and what each registered",
    run: () => {
      const { extensions } = g.inspect();
      if (extensions.length === 0) {
        return g.print("No extensions loaded. See docs/extensions.md.");
      }
      g.print([
        heading(g, "Extensions", "these run with your full permissions"),
        ...table(
          g,
          extensions.map((loaded) => ({
            name: loaded.name,
            tag: originOf(g, loaded.origin),
            note: loaded.contributed,
          })),
        ),
      ]);
    },
  });

  g.command("clear", {
    description: "Drop the conversation the model replays, keeping the transcript",
    run: () => {
      const outcome = g.clear();
      if (outcome === "cleared") return g.print("(context cleared)");
      g.print(
        outcome === "busy"
          ? "(cannot clear while a turn is running — press Esc first)"
          : "(nothing to clear)",
      );
    },
  });

  g.command("reload", {
    description: "Re-read extensions, skills and commands from disk",
    run: async () => {
      await g.reload();
      const { skills, commands, extensions } = g.inspect();
      g.print(
        `(reloaded — ${extensions.length} extensions, ${skills.length} skills, ${commands.length} commands)`,
      );
    },
  });

  g.command("compact", {
    description: "Summarise the conversation so far so it can keep going",
    // Success and failure are both reported where the compaction happens, so
    // an automatic one reads exactly like an asked-for one. This says only the
    // things that are true of a compaction that never started.
    run: async (args) => {
      const outcome = await g.compact(args.trim() === "" ? {} : { instruction: args.trim() });
      if (outcome.outcome === "too-short") g.print("(nothing worth compacting yet)");
      if (outcome.outcome === "busy") g.print("(cannot compact while a turn is running)");
    },
  });

  g.command("session", {
    description: "Show this session's id, size and what it has cost",
    run: () => {
      const { id, file, events } = g.session();
      const { tokens, context, total } = g.usage();
      const hit = total.input > 0 ? Math.round((total.cached / total.input) * 100) : 0;
      const percent =
        tokens !== null && context ? ` (${Math.round((tokens / context) * 100)}%)` : "";
      g.print([
        heading(g, "Session", id),
        ...table(g, [
          { name: "context", note: `${tokens ?? 0}${percent} of ${context ?? "unknown"}` },
          {
            name: "tokens",
            note: `${total.input} in · ${total.output} out · ${total.cached} cached (${hit}%)`,
          },
          { name: "cost", note: `$${total.cost.toFixed(4)} over ${total.steps} calls` },
          { name: "events", note: `${events}` },
          { name: "file", note: file },
        ]),
      ]);
    },
  });
}
