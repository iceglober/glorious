import type { Glrs, Line } from "../../../glrs-core/src";
import { createCodingTools } from "./tools";

// Every first-party capability that a third party could have written: the six tools
// that touch the machine, and every slash command. None of it is built in —
// the core registers no tools and no commands at all, and all of this arrives
// through exactly the API you would write against. That is the test: if /help
// or `bash` could not be written as an extension, "extensible" would be a
// claim rather than a fact.
//
// Replace any one piece by registering the same name in .glrs/extensions/ —
// a tool name is kept by whoever claims it first and your project is walked
// before first-party extensions, so a `bash` of your own simply wins.
//
// Shadowing this whole extension with a file called builtins.ts is a different
// and much larger thing than it used to be: it costs the six tools as well as
// the commands, which leaves the model unable to do anything. glrs says so at
// startup when it happens.
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
// part that actually matters is whether this is User, Project, or glrs's own.
const originOf = (g: Glrs, path: string): string => {
  if (path.includes("/v2/bundled/")) return "bundled";
  if (path.startsWith(g.root)) return "project";
  // GLRS_CONFIG_HOME may sit outside HOME, and Windows normally has USERPROFILE
  // and APPDATA rather than HOME. Any of them makes this a User resource.
  const userRoots = [
    process.env.GLRS_CONFIG_HOME,
    process.env.XDG_CONFIG_HOME,
    process.env.APPDATA,
    process.env.HOME,
    process.env.USERPROFILE,
  ].filter((root): root is string => root !== undefined && root !== "");
  if (userRoots.some((root) => path.toLowerCase().startsWith(root.toLowerCase()))) return "user";
  return "other";
};

export default function builtins(g: Glrs): void {
  for (const spec of createCodingTools(g.root, g.settings().toolTimeoutMs)) g.tool(spec);

  // Registered only where the answer can actually be written down. Without it
  // a decline lasts until the next turn and the same offer comes back forever,
  // which is worse than never offering — so if glrs may not write config, the
  // model is told to hand over the config line instead.
  if (g.available().some((one) => one.state === "undecided"))
    g.tool({
      name: "configure_extension",
      description:
        "Record that a first-party extension should or should not load, once the user has said so. Only for a clear answer to a suggestion you made — never to change what is loaded on your own initiative. Takes effect after a reload or restart.",
      input: g.z.object({
        name: g.z.string().describe("The extension's name, as listed in the available section"),
        enable: g.z
          .boolean()
          .describe("true when the user agreed to turn it on, false when they declined it"),
      }),
      execute: async ({ name, enable }) => {
        const outcome = await g.setExtension(name, enable);
        if (outcome === "written")
          return `Recorded: ${name} will ${enable ? "load" : "not load"}. It applies after a reload or restart.`;
        if (outcome === "already") return `${name} was already ${enable ? "enabled" : "disabled"}.`;
        if (outcome === "unknown") return `ERROR: ${name} is not a first-party extension.`;
        if (outcome === "not-allowed")
          return 'ERROR: glrs may not write config. Tell the user to add "agentConfigAllowlist": ["extensions"] to .glrs/config.json, or to add the extension to extensions.load themselves.';
        return "ERROR: could not write .glrs/config.json.";
      },
    });

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
            note: "interrupt the turn and hold queued messages",
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

  // `/extensions enable web-fetch` and `/extensions disable web-fetch`. Bare
  // `/extensions` still lists, so the thing it did before this is the thing it
  // does when you type it the way you always have.
  g.command("extensions", {
    description: "List loaded extensions, or enable/disable a first-party extension",
    run: async (args) => {
      const [verb, which] = args.trim().split(/\s+/u);
      if (verb === "enable" || verb === "disable") {
        if (!which) return g.print(`Usage: /extensions ${verb} <name>`, "warning");
        const outcome = await g.setExtension(which, verb === "enable");
        const said: Record<typeof outcome, string> = {
          written: `${which} will ${verb === "enable" ? "load" : "not load"} — reload or restart to apply`,
          already: `${which} is already ${verb === "enable" ? "enabled" : "disabled"}`,
          unknown: `${which} is not a first-party extension`,
          "not-allowed":
            'glrs may not write your config. Add "agentConfigAllowlist": ["extensions"] to ' +
            ".glrs/config.json, or edit extensions.load yourself.",
          failed: `could not write .glrs/config.json`,
        };
        return g.print(
          said[outcome],
          outcome === "written" || outcome === "already" ? "muted" : "warning",
        );
      }
      if (verb !== undefined && verb !== "")
        return g.print(`Usage: /extensions [enable|disable <name>]`, "warning");

      // What ships but is not on. Listed after the loaded ones, because what is
      // running matters more than what could.
      const offered = g.available().filter((one) => one.state !== "on");
      const { extensions } = g.inspect();
      if (extensions.length === 0) {
        return g.print("No extensions loaded. See docs/published/3-customize/4-extensions.md.");
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
        ...(offered.length === 0
          ? []
          : [
              blank,
              heading(g, "First-party, not loaded", "/extensions enable <name>"),
              ...table(
                g,
                offered.map((one) => ({
                  name: one.name,
                  tag: one.state === "off" ? "disabled" : "available",
                  note: one.summary,
                })),
              ),
            ]),
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
