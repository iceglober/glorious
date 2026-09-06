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

// One direction: glrs-coding-agent -> glrs-core -> glrs-providers. The product
// may reach anything below it, core may reach providers, and nothing reaches
// back up. Core reaching providers is deliberate: the runtime resolves a model
// to call, and a provider-neutral port with one implementation would be a
// layer that costs a file and decides nothing.
const rules = [
  {
    root: "packages/glrs-core/src",
    forbidden: ["@glrs-dev/glrs-coding-agent", "packages/glrs-coding-agent"],
  },
  {
    root: "packages/glrs-providers/src",
    forbidden: ["@glrs-dev/glrs-coding-agent", "packages/glrs-coding-agent"],
  },
  {
    root: "packages/extensions",
    forbidden: [
      "@glrs-dev/glrs-coding-agent",
      "@glrs-dev/glrs-providers",
      "packages/glrs-coding-agent",
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
