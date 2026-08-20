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

// Machine-wide rules. glrs read four of amp's locations and owned none of its
// own, so an administrator could install rules for amp on a machine and had no
// way to install them for glrs. Both are read; glrs's own come last, so they
// are the nearest and win.
const systemFiles = (): string[] => {
  if (process.platform === "darwin")
    return [
      "/etc/ampcode/AGENTS.md",
      "/Library/Application Support/ampcode/AGENTS.md",
      "/etc/glrs/AGENTS.md",
      "/Library/Application Support/glrs/AGENTS.md",
    ];
  if (process.platform === "win32") {
    const data = process.env.ProgramData ?? "C:\\ProgramData";
    return [join(data, "ampcode", "AGENTS.md"), join(data, "glrs", "AGENTS.md")];
  }
  return ["/etc/ampcode/AGENTS.md", "/etc/glrs/AGENTS.md"];
};

export const loadAgentRules = async (root: string, location = root): Promise<string> => {
  const base = isAbsolute(root) ? root : resolve(process.cwd(), root);
  const start = isAbsolute(location) ? location : resolve(base, location);
  const home = homedir();
  const directories = ancestors(start, home).reverse();
  const files = [
    ...systemFiles(),
    join(home, ".config", "amp", "AGENTS.md"),
    join(home, ".config", "glrs", "AGENTS.md"),
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
