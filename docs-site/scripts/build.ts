import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateDocuments } from "./generate-documents";
import { fetchStars, repoFromUrl } from "./stars";

const site = join(import.meta.dir, "..");
await generateDocuments(site);

// The star count is read from the same navigationLinks.github the toolbar
// links to, so the repository is named once. Written before TypeDoc starts;
// the theme reads the file and renders nothing when it is absent or short.
const options = JSON.parse(await readFile(join(site, "typedoc.json"), "utf8")) as {
  navigationLinks?: Record<string, string>;
};
const repo = repoFromUrl(options.navigationLinks?.github ?? "");
const stars = repo ? await fetchStars(repo) : null;
await mkdir(join(site, "generated"), { recursive: true });
await writeFile(join(site, "generated", "stars.json"), JSON.stringify({ repo, stars }));

const typedoc = Bun.spawn(["bunx", "typedoc", "--options", "typedoc.json"], {
  cwd: site,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const code = await typedoc.exited;
if (code !== 0) process.exit(code);
await cp(join(site, "public"), join(site, "dist"), { recursive: true });
