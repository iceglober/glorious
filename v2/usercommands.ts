import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Command } from "./commands";

// Same shape the skill roots use: project directories win over the home
// directory, so a repo can define a command that shadows a personal one.
// Returned without a leaf so everything loaded per-agent-directory —
// commands — walks the same list rather than each keeping its own
// copy that can drift.
export const agentDirectories = (root: string): string[] => {
  const home = homedir();
  const project: string[] = [];
  let current = resolve(root);
  while (true) {
    project.push(current);
    if (current === home) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [
    ...project.flatMap((directory) => [join(directory, ".glorious"), join(directory, ".agents")]),
    join(home, ".config", "agents"),
  ];
};

const commandRoots = (root: string): string[] =>
  agentDirectories(root).map((directory) => join(directory, "commands"));

export const scalar = (value: string): string => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
};

// A command file is frontmatter plus a body; the body is the prompt. Files
// without frontmatter are still valid — the whole file is the prompt.
export const parseCommandFile = (
  name: string,
  text: string,
): { description: string; body: string } => {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---")
    return { description: `Run the ${name} command`, body: text.trim() };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return { description: `Run the ${name} command`, body: text.trim() };
  const frontmatter = lines.slice(1, end);
  const described = frontmatter.find((line) => /^description:/u.test(line.trim()));
  return {
    description: described
      ? scalar(described.trim().slice("description:".length))
      : `Run the ${name} command`,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
  };
};

const readCommands = async (directory: string): Promise<Command[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const found: Command[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(directory, entry.name);
    const text = await Bun.file(path)
      .text()
      .catch(() => "");
    if (text.trim() === "") continue;
    const name = basename(entry.name, ".md").toLowerCase();
    const { description, body } = parseCommandFile(name, text);
    found.push({ name, description, run: null, body, origin: path });
  }
  return found;
};

// The first directory to define a name wins, so a project command shadows a
// personal one rather than both appearing.
export const loadUserCommands = async (root: string): Promise<Command[]> => {
  const seen = new Map<string, Command>();
  for (const directory of commandRoots(root))
    for (const command of await readCommands(directory))
      if (!seen.has(command.name)) seen.set(command.name, command);
  return [...seen.values()];
};
