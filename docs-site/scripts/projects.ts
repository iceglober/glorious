import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type DocumentationProject = {
  path: string;
  label: string;
  name: string;
  index: string;
  entryPoints: string[];
  projectDocuments: string[];
};

const scalar = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
};

export const projectFromIndex = (index: string, text: string): DocumentationProject => {
  const lines = text.split("\n");
  const end = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  if (end < 0) throw new Error(`${index}: project index needs frontmatter`);

  const fields = new Map<string, string>();
  const entryPoints: string[] = [];
  let list = "";
  for (const line of lines.slice(1, end)) {
    const item = /^\s+-\s+(.+)$/u.exec(line);
    if (item && list === "entryPoints") {
      entryPoints.push(resolve(dirname(index), scalar(item[1])));
      continue;
    }
    const pair = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (!pair) continue;
    list = pair[2].trim() === "" ? pair[1] : "";
    fields.set(pair[1], scalar(pair[2]));
  }

  const path = basename(dirname(index));
  const label = fields.get("label")?.trim() ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(path))
    throw new Error(`${index}: parent directory must be a URL-safe project path`);
  if (label === "") throw new Error(`${index}: frontmatter needs a label`);

  return {
    path,
    label,
    name: fields.get("name")?.trim() || label,
    index,
    entryPoints,
    projectDocuments: [join(dirname(index), "**", "!(index).md")],
  };
};

export const discoverProjects = async (published: string): Promise<DocumentationProject[]> => {
  const entries = await readdir(published, { withFileTypes: true });
  const projects: DocumentationProject[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const index = join(published, entry.name, "index.md");
    const text = await readFile(index, "utf8").catch(() => null);
    if (text !== null) projects.push(projectFromIndex(index, text));
  }
  if (projects.length === 0) throw new Error(`${published}: no */index.md documentation projects`);
  return projects;
};
