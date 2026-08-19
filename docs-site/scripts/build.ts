import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { discoverProjects } from "./projects.ts";

const site = join(import.meta.dir, "..");
const root = join(site, "..");
const out = join(site, "dist");
const published = join(root, "docs", "published");
const optionsPath = join(site, "typedoc.json");
const base = JSON.parse(await readFile(optionsPath, "utf8")) as Record<string, unknown>;
const projects = await discoverProjects(published);
const generatedOptions = join(site, ".typedoc-projects.json");
const generatedHomepage = join(site, ".typedoc-homepage.md");

const sourceLink = (file: string): string => {
  const path = relative(site, file).replaceAll("\\", "/");
  return path.startsWith(".") ? path : `./${path}`;
};
const homepage = projects
  .map((project) => `[${project.label}](${sourceLink(project.landingDocument ?? project.index)})`)
  .join("\n\n");
const options = {
  ...base,
  entryPoints: projects.flatMap((project) => project.entryPoints),
  projectDocuments: projects.flatMap((project) => project.projectDocuments),
  readme: generatedHomepage,
  out,
  documentationProjects: projects.map((project) => ({
    label: project.label,
    root: dirname(project.index),
    entryPoints: project.entryPoints,
  })),
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(generatedHomepage, `${homepage}\n`, "utf8");
await writeFile(generatedOptions, `${JSON.stringify(options, null, 2)}\n`, "utf8");
try {
  const typedoc = Bun.spawn(["bunx", "typedoc", "--options", generatedOptions], {
    cwd: site,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await typedoc.exited;
  if (code !== 0) process.exit(code);
} finally {
  await rm(generatedOptions, { force: true });
  await rm(generatedHomepage, { force: true });
}
await cp(join(site, "public"), out, { recursive: true });
