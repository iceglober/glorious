import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";

type Skill = {
  name: string;
  description: string;
  location: string;
  body: string;
};

export type SkillSummary = {
  name: string;
  description: string;
  location: string;
};

export type Skills = {
  catalog: string;
  summaries: readonly SkillSummary[];
  tool: ReturnType<typeof createSkillTool>;
};

const skillRoots = (root: string): string[] => [
  join(root, ".glorious", "skills"),
  join(root, ".agents", "skills"),
  join(root, ".claude", "skills"),
  join(homedir(), ".glorious", "skills"),
  join(homedir(), ".agents", "skills"),
  join(homedir(), ".claude", "skills"),
];

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

const parseSkill = (text: string, location: string): Skill | null => {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  let name = "";
  let description = "";
  let block = "";
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (block) {
      if (/^\s+/u.test(line)) {
        block += `${block ? " " : ""}${line.trim()}`;
        if (block.startsWith("description:"))
          description = block.slice("description:".length).trim();
        continue;
      }
      block = "";
    }
    const match = /^(name|description):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const value = match[2];
    if (value === "|" || value === "|-" || value === ">" || value === ">-") {
      block = `${match[1]}:`;
      continue;
    }
    if (match[1] === "name") name = scalar(value);
    else description = scalar(value);
  }
  if (!name || !description) return null;
  return {
    name,
    description,
    location,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
  };
};

const discover = async (root: string): Promise<Skill[]> => {
  const found: Skill[] = [];
  const seen = new Set<string>();
  for (const base of skillRoots(root)) {
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const location = resolve(base, entry.name, "SKILL.md");
      const skill = parseSkill(
        await Bun.file(location)
          .text()
          .catch(() => ""),
        location,
      );
      if (!skill || seen.has(skill.name)) continue;
      seen.add(skill.name);
      found.push(skill);
    }
  }
  return found;
};

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

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
      return `<skill_content name="${escapeXml(skill.name)}">\n${skill.body}\n\nSkill directory: ${escape(dirname(skill.location))}\n</skill_content>`;
    },
  });
};

export const loadSkills = async (root: string): Promise<Skills> => {
  const skills = await discover(root);
  const catalog =
    skills.length === 0
      ? ""
      : `<available_skills>\n${skills
          .map(
            (skill) =>
              `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
          )
          .join("\n")}\n</available_skills>`;
  return {
    catalog,
    summaries: skills.map(({ name, description, location }) => ({ name, description, location })),
    tool: createSkillTool(skills),
  };
};
