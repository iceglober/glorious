import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverProjects } from "./projects.ts";

const site = join(import.meta.dir, "..");
const root = join(site, "..");
const out = join(site, "dist");
const published = join(root, "docs", "published");
const optionsPath = join(site, "typedoc.json");
const base = JSON.parse(await readFile(optionsPath, "utf8")) as Record<string, unknown>;
const projects = await discoverProjects(published);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const project of projects) {
  const generated = join(site, `.typedoc-${project.path}.json`);
  const options = {
    ...base,
    name: project.name,
    entryPoints: project.entryPoints,
    projectDocuments: project.projectDocuments,
    readme: project.index,
    out: join(out, project.path),
  };
  await writeFile(generated, `${JSON.stringify(options, null, 2)}\n`, "utf8");
  try {
    const typedoc = Bun.spawn(["bunx", "typedoc", "--options", generated], {
      cwd: site,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await typedoc.exited;
    if (code !== 0) process.exit(code);
  } finally {
    await rm(generated, { force: true });
  }
}

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const navigationLinks = Object.entries((base.navigationLinks ?? {}) as Record<string, string>);
const toolbarLinks = navigationLinks
  .map(([label, url]) => `<a href="${escape(url)}">${escape(label)}</a>`)
  .join("");
const projectLinks = projects
  .map(
    (project) =>
      `<p><a href="/${encodeURIComponent(project.path)}/">${escape(project.label)}</a></p>`,
  )
  .join("\n");
const siteName = escape(String(base.name ?? "documentation"));
const landing = `<!DOCTYPE html><html class="default" lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${siteName}</title><link rel="stylesheet" href="assets/style.css"/><link rel="stylesheet" href="assets/highlight.css"/><link rel="stylesheet" href="assets/custom.css"/></head><body><header class="tsd-page-toolbar"><div class="tsd-toolbar-contents container"><a href="/" class="title">${siteName}</a><div id="tsd-toolbar-links">${toolbarLinks}</div></div></header><main class="container project-landing"><div class="col-content"><div class="tsd-page-title"><h1>${siteName}</h1></div><div class="tsd-panel tsd-typography">${projectLinks}</div></div></main></body></html>\n`;

await cp(join(out, projects[0].path, "assets"), join(out, "assets"), { recursive: true });
await cp(join(site, "public"), out, { recursive: true });
await writeFile(join(out, "index.html"), landing, "utf8");
