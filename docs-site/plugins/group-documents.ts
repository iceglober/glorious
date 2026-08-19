import { readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import {
  Application,
  Converter,
  DocumentReflection,
  type ProjectReflection,
} from "typedoc";

export const documentFolderNames = new Set<string>();

const globRoot = (pattern: string): string | null => {
  const at = pattern.search(/[*?[\]{}()!]/u);
  if (at < 0) return null;
  const prefix = pattern.slice(0, at);
  const directory = prefix.endsWith("/") || prefix.endsWith("\\") ? prefix : dirname(prefix);
  return resolve(directory);
};

const documentTitle = (file: string): string => {
  const text = readFileSync(file, "utf8");
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    const title = /^title:\s*(.+)$/mu.exec(text.slice(4, end < 0 ? undefined : end))?.[1]?.trim();
    if (title) return title.replace(/^(["'])(.*)\1$/u, "$2");
  }
  return basename(file, extname(file));
};

const label = (segment: string): string =>
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

export function load(application: Application): void {
  const patterns = application.options.getValue("projectDocuments") as readonly string[];
  if (!patterns.some((pattern) => globRoot(pattern) !== null)) return;

  const pending = new Map<
    DocumentReflection,
    { directories: string[]; file: string }
  >();
  const sortPaths = new Map<DocumentReflection, string>();
  const folderPaths = new Map<DocumentReflection, string>();
  application.converter.on(
    Converter.EVENT_CREATE_DOCUMENT,
    (_context: undefined, document: DocumentReflection) => {
      const file = document.project.files.getReflectionPath(document);
      if (!file) return;
      const path = documentPath(file, patterns);
      if (path) sortPaths.set(document, path);
      const directories = documentDirectories(file, patterns);
      if (directories) pending.set(document, { directories, file });
    },
  );

  application.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const folders = new Map<string, DocumentReflection>();
    for (const [document, { directories, file }] of pending) {
      let parent: ProjectReflection | DocumentReflection = context.project;
      let key = "";
      for (const directory of directories) {
        key = key ? `${key}/${directory}` : directory;
        let folder = folders.get(key);
        if (!folder) {
          const name = label(directory);
          folder = new DocumentReflection(name, parent, [], {});
          documentFolderNames.add(name);
          parent.addChild(folder);
          context.project.registerReflection(folder, undefined, undefined);
          folders.set(key, folder);
          folderPaths.set(folder, `${key}/`);
        }
        parent = folder;
      }
      context.project.removeChild(document);
      document.name = documentTitle(file);
      parent.addChild(document);
      document.parent = parent;
      if (typeof document.frontmatter.group === "string") delete document.frontmatter.group;
    }
  }, 1000);

  application.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    // TypeDoc's normal resolve pass sorts reflections after RESOLVE_BEGIN. Move
    // all external documents and directory groups back into path order after
    // that pass, before the renderer builds navigation.
    const documentChildren = context.project.documents ?? [];
    const documents = documentChildren
      .filter((child) => sortPaths.has(child) || folderPaths.has(child))
      .sort((left, right) =>
        compareDocumentPaths(
          sortPaths.get(left) ?? folderPaths.get(left) ?? "",
          sortPaths.get(right) ?? folderPaths.get(right) ?? "",
        ),
      );
    documentChildren.splice(0, documentChildren.length, ...documents);
    context.project.childrenIncludingDocuments = [
      ...documents,
      ...(context.project.children ?? []),
    ];

    // The index page is rendered from reflection groups rather than directly
    // from project.children. Keep the Documents group in the same order.
    for (const group of context.project.groups ?? []) {
      const grouped = group.children as unknown as DocumentReflection[];
      const ordered = documents.filter((document) => grouped.some((child) => child.id === document.id));
      if (ordered.length === 0) continue;
      const ids = new Set(ordered.map((document) => document.id));
      grouped.splice(0, grouped.length, ...ordered, ...grouped.filter((child) => !ids.has(child.id)));
    }
  }, -1000);
}
