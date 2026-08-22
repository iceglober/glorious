import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";

// `glrs-docs.md` is every published page in one file, for pasting into a model
// that has no filesystem. It was maintained by hand and had already drifted: at
// the commit that last touched it, the quick start it carried was two sections
// short of the quick start on disk.
//
// So it is generated now, and `bun run check` fails when it is stale. Run
// `bun run docs:bundle` after editing anything under `docs/published/`.

const root = join(import.meta.dir, "..");
const published = join(root, "docs", "published");
const bundle = join(root, "glrs-docs.md");

// `9-reference` is `reference` here, and `4-models.md` is `models.md`. The
// numbers order the directory; they are not part of any page's name.
const unnumbered = (name: string): string => name.replace(/^\d+-/u, "");

const byNumber = (left: string, right: string): number =>
  Number.parseInt(left, 10) - Number.parseInt(right, 10);

const titleOf = (text: string): string | null =>
  text.match(/^---\r?\n[\s\S]*?^title:\s*(.+?)\s*$[\s\S]*?^---\r?\n/mu)?.[1] ?? null;

// The page's own title, not its filename: `2-first-extension.md` is titled
// "your first extension" and appears as `tutorials/your-first-extension.md`.
const slug = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/&/gu, "and")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

const withoutFrontMatter = (text: string): string =>
  text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").replace(/^\s*\n/u, "");

type Page = { source: string; name: string; text: string };

const pages = async (): Promise<Page[]> => {
  const groups = (await readdir(published, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(byNumber);
  const found: Page[] = [];
  for (const group of groups) {
    const files = (await readdir(join(published, group)))
      .filter((file) => file.endsWith(".md"))
      .sort(byNumber);
    for (const file of files) {
      const text = await readFile(join(published, group, file), "utf8");
      const title = titleOf(text) ?? basename(file, ".md");
      found.push({
        source: `${group}/${file}`,
        name: `${unnumbered(group)}/${slug(title)}.md`,
        text,
      });
    }
  }
  return found;
};

// A relative link between two pages becomes a link between two sections of the
// one file. Anything that resolves to no page is left alone and reported.
const relink = (page: Page, names: Map<string, string>, broken: string[]): string =>
  withoutFrontMatter(page.text).replace(
    /\]\(([^)#]+\.md)(#[^)]*)?\)/gu,
    (whole, target: string, hash: string | undefined) => {
      const resolved = posix.normalize(posix.join(posix.dirname(page.source), target));
      const name = names.get(resolved);
      if (name === undefined) {
        broken.push(`${page.source} -> ${target}`);
        return whole;
      }
      return `](${name}${hash ?? ""})`;
    },
  );

const build = async (): Promise<{ text: string; broken: string[] }> => {
  const all = await pages();
  const names = new Map(all.map((page) => [page.source, page.name]));
  const broken: string[] = [];
  const text = all.map((page) => `${page.name}\n\n${relink(page, names, broken)}`).join("\n\n");
  return { text, broken };
};

const { text, broken } = await build();
if (broken.length > 0) {
  process.stderr.write(`glrs-docs.md: ${broken.length} link(s) resolve to no page:\n`);
  for (const one of broken) process.stderr.write(`  ${one}\n`);
  process.exitCode = 1;
}

if (process.argv.includes("--write")) {
  await writeFile(bundle, text, "utf8");
  process.stdout.write(`glrs-docs.md: written, ${text.length} characters\n`);
} else {
  const current = await readFile(bundle, "utf8").catch(() => null);
  if (current !== text) {
    process.stderr.write(
      "glrs-docs.md is stale. Run `bun run docs:bundle` and commit the result.\n",
    );
    process.exitCode = 1;
  }
}
