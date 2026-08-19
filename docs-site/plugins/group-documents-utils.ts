import { readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

const globRoot = (pattern: string): string | null => {
  const at = pattern.search(/[*?[\]{}()!]/u);
  if (at < 0) return null;
  const prefix = pattern.slice(0, at);
  const directory = prefix.endsWith("/") || prefix.endsWith("\\") ? prefix : dirname(prefix);
  return resolve(directory);
};

export const hasDocumentGlob = (patterns: readonly string[]): boolean =>
  patterns.some((pattern) => globRoot(pattern) !== null);

export const documentTitle = (file: string): string => {
  const text = readFileSync(file, "utf8");
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    const title = /^title:\s*(.+)$/mu.exec(text.slice(4, end < 0 ? undefined : end))?.[1]?.trim();
    if (title) return title.replace(/^(["'])(.*)\1$/u, "$2");
  }
  return basename(file, extname(file));
};

export const directoryLabel = (segment: string): string =>
  segment
    .split(/[-_]/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");

export const compareDocumentPaths = (left: string, right: string): number =>
  left.localeCompare(right);

export const documentPath = (file: string, patterns: readonly string[]): string | null => {
  for (const pattern of patterns) {
    const root = globRoot(pattern);
    if (!root) continue;
    const path = relative(root, file);
    if (path !== ".." && !path.startsWith(`..${sep}`)) return path;
  }
  return null;
};

export const documentDirectories = (
  file: string,
  patterns: readonly string[],
): string[] | null => {
  for (const pattern of patterns) {
    const root = globRoot(pattern);
    if (!root) continue;
    const nested = relative(root, dirname(file));
    if (nested === "" || nested === "." || nested === ".." || nested.startsWith(`..${sep}`))
      continue;
    return nested.split(sep).filter(Boolean);
  }
  return null;
};
