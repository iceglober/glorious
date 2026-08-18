import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const source = join(
  import.meta.dir,
  "..",
  "..",
  "packages",
  "glorious-coding-agent",
  "src",
  "extension-api.ts",
);
const output = join(import.meta.dir, "..", "src", "generated", "extension-api.md");
const text = await readFile(source, "utf8");
const lines = text.split("\n");
const declarations: string[] = [];
for (let i = 0; i < lines.length; i += 1) {
  if (!/^export (type|const) /u.test(lines[i] ?? "")) continue;
  const start = i;
  i += 1;
  while (i < lines.length && !/^export (type|const) /u.test(lines[i] ?? "")) i += 1;
  declarations.push(lines.slice(start, i).join("\n").trim());
  i -= 1;
}

const markdown = `# Extension API

This page is generated from the coding agent's extension API at docs-site build time. The exported surface is the public contract for extensions.

Start with [the extension guide](/extensions), then use this page for the complete typed reference.

${declarations.map((declaration) => `\n\`\`\`ts\n${declaration}\n\`\`\``).join("\n")}
`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, markdown);
console.log(`generated ${output}`);
