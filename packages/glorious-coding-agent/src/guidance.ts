import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const names = ["AGENTS.md", "AGENT.md", "CLAUDE.md"] as const;

const readOne = async (directory: string): Promise<{ path: string; text: string } | null> => {
  for (const name of names) {
    const path = join(directory, name);
    const text = await readFile(path, "utf8").catch(() => null);
    if (text !== null) return { path, text };
  }
  return null;
};

const ancestors = (start: string, stop: string): string[] => {
  const result: string[] = [];
  let current = start;
  while (true) {
    result.push(current);
    if (current === stop) return result;
    const parent = dirname(current);
    if (parent === current) return result;
    current = parent;
  }
};

const systemFiles = (): string[] => {
  if (process.platform === "darwin")
    return ["/etc/ampcode/AGENTS.md", "/Library/Application Support/ampcode/AGENTS.md"];
  if (process.platform === "win32")
    return [join(process.env.ProgramData ?? "C:\\ProgramData", "ampcode", "AGENTS.md")];
  return ["/etc/ampcode/AGENTS.md"];
};

export const loadAgentRules = async (root: string, location = root): Promise<string> => {
  const base = isAbsolute(root) ? root : resolve(process.cwd(), root);
  const start = isAbsolute(location) ? location : resolve(base, location);
  const home = homedir();
  const directories = ancestors(start, home).reverse();
  const files = [
    ...systemFiles(),
    join(home, ".config", "amp", "AGENTS.md"),
    join(home, ".config", "AGENTS.md"),
  ];
  for (const directory of directories) {
    const entry = await readOne(directory);
    if (entry) files.push(entry.path);
  }
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(file, "utf8").catch(() => null);
    if (text !== null && text.trim() !== "") entries.push(text.trim());
  }
  return entries.join("\n\n");
};
