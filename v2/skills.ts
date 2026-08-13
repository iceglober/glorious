import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Command } from "./commands";
import type { McpServerConfig, McpSession } from "./mcp";

type Skill = {
  name: string;
  description: string;
  trigger: string;
  location: string;
  body: string;
  mcpServers: Record<string, McpServerConfig>;
};

export type SkillSummary = {
  name: string;
  description: string;
  location: string;
};

export type Skills = {
  catalog: string;
  // skills that declared a trigger, ready to be registered as slash commands
  commands: Command[];
  summaries: readonly SkillSummary[];
  tool: ReturnType<typeof createSkillTool>;
};

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

const skillRoots = (root: string): string[] => {
  const home = homedir();
  const project = ancestors(root);
  return [
    join(home, ".config", "agents", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".config", "amp", "skills"),
    ...project.flatMap((directory) => [
      join(directory, ".agents", "skills"),
      join(directory, ".claude", "skills"),
    ]),
    join(home, ".claude", "skills"),
    join(home, ".claude", "plugins", "cache"),
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

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parseMcpServers = (value: string): Record<string, McpServerConfig> => {
  const parsed = parseJson(value) as Record<string, McpServerConfig> | null;
  return parsed && typeof parsed === "object" ? parsed : {};
};

const parseMcpBlock = (lines: string[]): Record<string, McpServerConfig> => {
  const servers: Record<string, McpServerConfig> = {};
  let current = "";
  for (const line of lines) {
    const server = /^\s{2}([\w.-]+):\s*$/u.exec(line);
    if (server) {
      current = server[1];
      servers[current] = { command: "" };
      continue;
    }
    if (!current) continue;
    const field = /^\s{4}(command|args|env|tools|disabled):\s*(.*)$/u.exec(line);
    if (!field) continue;
    const value = scalar(field[2]);
    if (field[1] === "command") servers[current].command = value;
    else if (field[1] === "disabled") servers[current].disabled = value === "true";
    else if (field[1] === "args" || field[1] === "tools") {
      const parsed = parseJson(value);
      if (Array.isArray(parsed)) servers[current][field[1]] = parsed as string[];
    } else {
      const parsed = parseJson(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        servers[current].env = parsed as Record<string, string>;
    }
  }
  return Object.fromEntries(Object.entries(servers).filter(([, config]) => config.command));
};

const parseSkill = (text: string, location: string): Skill | null => {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  let name = "";
  let description = "";
  let trigger = "";
  let mcpServers: Record<string, McpServerConfig> = {};
  let block = "";
  const frontmatter = lines.slice(1, end);
  const mcpLine = frontmatter.findIndex((line) => /^mcpServers:/u.test(line));
  if (mcpLine >= 0) {
    const value = frontmatter[mcpLine].slice("mcpServers:".length).trim();
    mcpServers =
      value === "" ? parseMcpBlock(frontmatter.slice(mcpLine + 1)) : parseMcpServers(value);
  }
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
    const match = /^(name|description|trigger):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const value = match[2];
    if (value === "|" || value === "|-" || value === ">" || value === ">-") {
      block = `${match[1]}:`;
      continue;
    }
    if (match[1] === "name") name = scalar(value);
    // a skill may declare the slash command it answers to, leading slash optional
    else if (match[1] === "trigger") trigger = scalar(value).replace(/^\//u, "").toLowerCase();
    else description = scalar(value);
  }
  if (!name || !description) return null;
  return {
    name,
    description,
    trigger,
    location,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
    mcpServers,
  };
};

const nestedSkillFiles = async (base: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(base, entry.name);
    if (entry.isDirectory()) files.push(...(await nestedSkillFiles(path)));
    else if (entry.name === "SKILL.md") files.push(path);
  }
  return files;
};

const discover = async (root: string): Promise<Skill[]> => {
  const found: Skill[] = [];
  const seen = new Set<string>();
  const roots = skillRoots(root);
  for (const [index, base] of roots.entries()) {
    const locations =
      index === roots.length - 2
        ? await nestedSkillFiles(base)
        : (await readdir(base, { withFileTypes: true }).catch(() => []))
            .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
            .map((entry) => resolve(base, entry.name, "SKILL.md"));
    for (const location of locations) {
      const skillText = await Bun.file(location)
        .text()
        .catch(() => "");
      const parsed = parseSkill(skillText, location);
      const sibling = (await Bun.file(join(dirname(location), "mcp.json"))
        .json()
        .catch(() => null)) as
        | { mcpServers?: Record<string, McpServerConfig> }
        | Record<string, McpServerConfig>
        | null;
      const siblingServers: Record<string, McpServerConfig> =
        sibling && "mcpServers" in sibling
          ? ((sibling.mcpServers as Record<string, McpServerConfig> | undefined) ?? {})
          : ((sibling as Record<string, McpServerConfig> | null) ?? {});
      const skill = parsed
        ? {
            ...parsed,
            mcpServers:
              Object.keys(parsed.mcpServers).length > 0 ? parsed.mcpServers : siblingServers,
          }
        : null;
      if (!skill || basename(dirname(location)) !== skill.name || seen.has(skill.name)) continue;
      seen.add(skill.name);
      found.push(skill);
    }
  }
  return found;
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

const createSkillTool = (skills: Skill[], mcp?: McpSession) => {
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
      if (mcp && Object.keys(skill.mcpServers).length > 0)
        await mcp.loadSkillServers(skill.name, skill.mcpServers);
      return `<skill_content name="${escapeXml(skill.name)}">\n${skill.body}\n\nSkill directory: ${escapeXml(dirname(skill.location))}\n</skill_content>`;
    },
  });
};

export const loadSkills = async (root: string, mcp?: McpSession): Promise<Skills> => {
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
    // Typing the trigger is an explicit choice, so the skill is injected rather
    // than merely offered — the model does not get to decide whether to load it.
    commands: skills
      .filter((skill) => skill.trigger !== "")
      .map((skill) => ({
        name: skill.trigger,
        description: skill.description,
        run: null,
        body: triggerPrompt(skill),
        origin: skill.location,
      })),
    summaries: skills.map(({ name, description, location }) => ({ name, description, location })),
    tool: createSkillTool(skills, mcp),
  };
};
