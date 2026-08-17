import type { Glorious, Line } from "../extension-api";

// Every slash command glorious ships. None of them are built in — the core
// registers no commands at all, and these arrive through exactly the API a
// third party writes against. That is the test: if /help could not be written
// as an extension, "extensible" would be a claim rather than a fact.
//
// Shadow any of them with your own .glorious/extensions/builtins.ts, or delete
// the lot and write your own. Nothing in the core depends on them existing.
//
// They print into the transcript rather than opening a panel over it. A listing
// you can scroll back to, copy out of, and read beside the work that prompted it
// beats one that takes the screen and has to be dismissed — and it costs the API
// no windowing surface to support.

const heading = (text: string): Line => [{ text, tone: "accent", bold: true }];
const blank: Line = [{ text: "" }];

const entry = (name: string, description: string, origin?: string): Line[] => [
  [
    { text: name, tone: "highlight", bold: true },
    { text: `  ${description}`, tone: "muted" },
  ],
  ...(origin === undefined
    ? []
    : [[{ text: `    ${origin}`, tone: "muted", italic: true }] as Line]),
];

export default function builtins(g: Glorious): void {
  g.command("help", {
    description: "Show commands, sequences, and keys",
    run: () => {
      const { commands, sequences } = g.inspect();
      g.print([
        heading("Commands"),
        [{ text: "Type / to complete. ↑/↓ to move, Tab to complete, Enter to run." }],
        blank,
        ...commands.flatMap((command) => entry(`/${command.name}`, command.description)),
        ...(sequences.length === 0
          ? []
          : [
              blank,
              heading("Sequences"),
              [{ text: "Type $ to run one. These are project scripts, not the model." }],
              blank,
              ...sequences.flatMap((sequence) => entry(`$${sequence.name}`, sequence.description)),
            ]),
        blank,
        heading("Keys"),
        [{ text: "Esc      interrupt the turn, or drop the newest queued message" }],
        [{ text: "Ctrl+C   clear the composer · once on empty interrupts · twice quits" }],
        [{ text: "!        run the rest of the line as a shell command" }],
      ]);
    },
  });

  g.command("skills", {
    description: "List available skills",
    run: () => {
      const { skills } = g.inspect();
      if (skills.length === 0) return g.print("No skills found.");
      g.print([
        heading("Skills"),
        blank,
        ...skills.flatMap((skill) => entry(skill.name, skill.description, skill.location)),
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
        heading("Extensions"),
        [{ text: "These run with your full permissions.", tone: "muted" }],
        blank,
        ...extensions.flatMap((loaded) => entry(loaded.name, loaded.contributed, loaded.origin)),
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
    description: "Re-read skills, commands and sequences from disk",
    run: async () => {
      await g.reload();
      const { skills, commands, sequences } = g.inspect();
      g.print(
        `(reloaded — ${skills.length} skills, ${commands.length} commands, ${sequences.length} sequences)`,
      );
    },
  });
}
