import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const files = async (dir: string): Promise<string[]> => {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
};

const rules = [
  {
    root: "packages/glorious-core/src",
    forbidden: [
      "@glrs-dev/glorious-coding-agent",
      "@glrs-dev/provider-registry",
      "packages/glorious-coding-agent",
    ],
  },
  {
    root: "packages/provider-registry/src",
    forbidden: ["@glrs-dev/glorious-coding-agent", "packages/glorious-coding-agent"],
  },
  {
    root: "packages/extensions",
    forbidden: [
      "@glrs-dev/glorious-coding-agent",
      "@glrs-dev/provider-registry",
      "packages/glorious-coding-agent",
    ],
  },
];

const violations: string[] = [];
for (const rule of rules)
  for (const file of await files(rule.root)) {
    const text = await readFile(file, "utf8");
    for (const dependency of rule.forbidden)
      if (text.includes(dependency)) violations.push(`${file}: forbidden dependency ${dependency}`);
  }

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
