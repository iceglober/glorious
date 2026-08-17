import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Command } from "./commands";

type Skill = {
  name: string;
  description: string;
  trigger: string;
  location: string;
  body: string;
  // Frontmatter the Agent Skills standard defines but glorious does not act on
  // itself. Parsed and carried so `/skills` can show it and an extension can do
  // something with it, rather than being dropped on the floor for being unused.
  license: string;
  compatibility: string;
  allowedTools: readonly string[];
  metadata: Readonly<Record<string, string>>;
  // Not part of the standard. See MODEL_INVOCATION_FIELD below.
  modelInvocable: boolean;
};

export type SkillSummary = {
  name: string;
  description: string;
  location: string;
  trigger: string;
  modelInvocable: boolean;
  allowedTools: readonly string[];
  compatibility: string;
};

export type Skills = {
  catalog: string;
  // every skill, ready to be registered as a slash command
  commands: Command[];
  summaries: readonly SkillSummary[];
  // What was wrong with a skill file, in the words of whoever has to fix it.
  // A skill that fails to load says so rather than disappearing — the same bet
  // extensions make, and for the same reason: silence looks like a skill that
  // was never written.
  warnings: readonly string[];
  tool: ReturnType<typeof createSkillTool>;
};

// `disable-model-invocation` is NOT part of the Agent Skills specification.
// Enough agents grew the same field independently that a skill carrying it now
// expects it to be honoured everywhere, so glorious honours it — but it is a
// convention, not a standard, and is documented as one in docs/skills.md.
const MODEL_INVOCATION_FIELD = "disable-model-invocation";

// The standard: 1–64 characters, lowercase letters, numbers and single inner
// hyphens. Enforced leniently — a name that breaks the rule warns and still
// loads, because refusing to run someone's skill over a capital letter helps
// nobody.
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;
const LEGAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const ancestors = (root: string): string[] => {
  const home = homedir();
  const directories: string[] = [];
  let current = resolve(root);
  while (true) {
    directories.push(current);
    if (current === home) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
};

// glorious's own directory and the vendor-neutral Agent Skills layout, and
// nothing else. It used to also read ~/.claude/skills, every ancestor's
// .claude/skills, ~/.claude/plugins/cache and ~/.config/amp/skills — so another
// tool's whole skill surface arrived as glorious slash commands, and every one
// of those names and descriptions was paid for in the per-turn preamble. Put a
// symlink in .agents/skills/ if you want one of them here.
const skillRoots = (root: string): string[] => {
  const home = homedir();
  return [
    join(home, ".config", "agents", "skills"),
    join(home, ".agents", "skills"),
    ...ancestors(root).map((directory) => join(directory, ".agents", "skills")),
    join(root, ".glorious", "skills"),
  ];
};

const scalar = (value: string): string => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
};

// Frontmatter, loosely. Every field the standard defines is recognised;
// anything else is ignored rather than rejected, so a skill written for another
// agent still loads here.
const FIELDS = [
  "name",
  "description",
  "trigger",
  "license",
  "compatibility",
  "allowed-tools",
  MODEL_INVOCATION_FIELD,
] as const;

const truthy = (value: string): boolean => ["true", "yes", "1", "on"].includes(value.toLowerCase());

const parseSkill = (
  text: string,
  location: string,
): { skill: Skill | null; warnings: string[] } => {
  const warnings: string[] = [];
  const where = location.replace(homedir(), "~");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---")
    return { skill: null, warnings: [`${where}: no frontmatter — a skill needs --- at the top`] };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { skill: null, warnings: [`${where}: frontmatter is never closed with ---`] };

  const fields = new Map<string, string>();
  const metadata: Record<string, string> = {};
  let block = "";
  let inMetadata = false;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    const indented = /^\s+/u.test(line);
    if (block) {
      if (indented) {
        const carried = fields.get(block) ?? "";
        fields.set(block, `${carried}${carried === "" ? "" : " "}${line.trim()}`);
        continue;
      }
      block = "";
    }
    // `metadata:` is an arbitrary mapping, so its children are collected rather
    // than matched against the known field names.
    if (inMetadata) {
      if (indented) {
        const pair = /^\s+([^:]+):\s*(.*)$/u.exec(line);
        if (pair) metadata[pair[1].trim()] = scalar(pair[2]);
        continue;
      }
      inMetadata = false;
    }
    if (/^metadata:\s*$/u.test(line)) {
      inMetadata = true;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!FIELDS.includes(key as (typeof FIELDS)[number])) continue;
    const value = match[2];
    if (["|", "|-", ">", ">-"].includes(value.trim())) {
      block = key;
      fields.set(key, "");
      continue;
    }
    fields.set(key, scalar(value));
  }

  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  // The two required fields. Without a name there is nothing to call it by;
  // without a description the model has no way to know when it applies, and a
  // skill nothing can choose is not a loaded skill.
  if (name === "") return { skill: null, warnings: [`${where}: no name in the frontmatter`] };
  if (description === "")
    return {
      skill: null,
      warnings: [`${where}: "${name}" has no description, so nothing can tell when to use it`],
    };

  if (name.length > NAME_MAX) warnings.push(`${where}: name is longer than ${NAME_MAX} characters`);
  if (!LEGAL_NAME.test(name))
    warnings.push(
      `${where}: "${name}" is not a standard skill name — lowercase letters, numbers and single inner hyphens. Loaded anyway.`,
    );
  if (description.length > DESCRIPTION_MAX)
    warnings.push(
      `${where}: description is ${description.length} characters, over the ${DESCRIPTION_MAX} the standard allows. It is paid for on every turn.`,
    );
  const compatibility = fields.get("compatibility") ?? "";
  if (compatibility.length > COMPATIBILITY_MAX)
    warnings.push(`${where}: compatibility is over ${COMPATIBILITY_MAX} characters`);

  return {
    skill: {
      name,
      description,
      trigger: (fields.get("trigger") ?? "").replace(/^\//u, "").toLowerCase(),
      location,
      license: fields.get("license") ?? "",
      compatibility,
      allowedTools: (fields.get("allowed-tools") ?? "").split(/\s+/u).filter((one) => one !== ""),
      metadata,
      modelInvocable: !truthy(fields.get(MODEL_INVOCATION_FIELD) ?? ""),
      body: lines
        .slice(end + 1)
        .join("\n")
        .trim(),
    },
    warnings,
  };
};

// A skill is a directory with a SKILL.md in it, wherever that directory sits.
// Only the top level of each root used to be looked at, so skills grouped into
// folders — which is how anyone with more than a handful organises them — were
// invisible. Bounded, because a skills root is a place someone put skills, not
// somewhere to go hunting through a whole checkout.
const MAX_DEPTH = 4;
const SKIP = new Set(["node_modules", ".git", "scripts", "references", "assets"]);

const skillFiles = async (base: string, depth = 0): Promise<string[]> => {
  if (depth > MAX_DEPTH) return [];
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const here = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
  // A directory that is itself a skill is not also searched for more: its
  // references/ and scripts/ are the skill's own material, not further skills.
  if (here) return [join(base, "SKILL.md")];
  const found = await Promise.all(
    entries
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !SKIP.has(entry.name))
      .map((entry) => skillFiles(join(base, entry.name), depth + 1)),
  );
  return found.flat();
};

const discover = async (root: string): Promise<{ skills: Skill[]; warnings: string[] }> => {
  const found: Skill[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  for (const base of skillRoots(root)) {
    for (const location of await skillFiles(resolve(base))) {
      const text = await Bun.file(location)
        .text()
        .catch(() => "");
      const parsed = parseSkill(text, location);
      warnings.push(...parsed.warnings);
      const skill = parsed.skill;
      if (!skill) continue;
      // The name comes from the frontmatter. It used to have to match the
      // directory too, and a skill whose folder had been renamed vanished with
      // nothing said — which is a rename, not a mistake worth refusing over.
      const folder = basename(dirname(location));
      if (folder !== skill.name)
        warnings.push(
          `${location.replace(homedir(), "~")}: skill is named "${skill.name}" but sits in ${folder}/`,
        );
      const already = seen.get(skill.name);
      if (already !== undefined) {
        warnings.push(
          `two skills are named "${skill.name}" — using ${already.replace(homedir(), "~")}, ignoring ${location.replace(homedir(), "~")}`,
        );
        continue;
      }
      seen.set(skill.name, location);
      found.push(skill);
    }
  }
  return { skills: found, warnings };
};

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const skillContent = (skill: Skill): string =>
  `<skill_content name="${escapeXml(skill.name)}">\n${skill.body}\n\nSkill directory: ${escapeXml(dirname(skill.location))}\n</skill_content>`;

// Typing a trigger is a request to run the skill, so it arrives framed as an
// instruction. Handed over bare, the block reads as reference material and the
// model answers with "what would you like me to work on?" instead of acting.
const triggerPrompt = (skill: Skill): string =>
  `Run the ${skill.name} skill now. The user invoked it as a slash command, so the instructions below are what to carry out — not background material, and not something to summarise or ask about. Follow them from the top. Any text after the command name is the skill's arguments.\n\n${skillContent(skill)}`;

const createSkillTool = (skills: Skill[]) => {
  if (skills.length === 0) return undefined;
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return tool({
    description:
      "Load the full instructions for an available skill. The skills available to you are listed in the <skills> block of the current message; pass one of those names exactly.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Skill name to activate, exactly as listed in <skills>"),
    }),
    execute: async ({ name }) => {
      const skill = byName.get(name);
      if (!skill) return `ERROR: unknown skill: ${name}`;
      return `<skill_content name="${escapeXml(skill.name)}">\n${skill.body}\n\nSkill directory: ${escapeXml(dirname(skill.location))}\n</skill_content>`;
    },
  });
};

export const loadSkills = async (root: string): Promise<Skills> => {
  const { skills, warnings } = await discover(root);
  // What the model is told exists. A skill that opted out of model invocation is
  // absent from here — which is the whole of that field: it does not appear in
  // the preamble, it is not activatable, and the only way to it is typing its
  // command.
  const offered = skills.filter((skill) => skill.modelInvocable);
  const catalog =
    offered.length === 0
      ? ""
      : `<available_skills>\n${offered
          .map(
            (skill) =>
              `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
          )
          .join("\n")}\n</available_skills>`;
  return {
    catalog,
    warnings,
    // Every skill is reachable as a slash command named after it. Gating this on
    // a `trigger:` field meant a skill that dropped the field lost its command
    // without warning — which is exactly what happened when graphify shipped
    // 0.9.41. `trigger:` now only renames the command.
    commands: skills.map((skill) => ({
      name: skill.trigger === "" ? skill.name.toLowerCase() : skill.trigger,
      description: skill.description,
      run: null,
      body: triggerPrompt(skill),
      origin: skill.location,
    })),
    summaries: skills.map(
      ({ name, description, location, trigger, modelInvocable, allowedTools, compatibility }) => ({
        name,
        description,
        location,
        trigger,
        modelInvocable,
        allowedTools,
        compatibility,
      }),
    ),
    // Only what the model was told about can be activated by it, or the opt-out
    // would be a listing change with a way around it.
    tool: createSkillTool(offered),
  };
};
