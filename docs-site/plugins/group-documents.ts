import {
  Application,
  Converter,
  DocumentReflection,
  ParameterType,
  type ProjectReflection,
} from "typedoc";
import {
  compareDocumentPaths,
  directoryLabel,
  documentDirectories,
  documentPath,
  documentTitle,
  hasDocumentGlob,
} from "./group-documents-utils.ts";

export const documentFolderNames = new Set<string>();

export function load(application: Application): void {
  application.options.addDeclaration({
    name: "lowercaseDocumentGroupTitles",
    help: "Render document directory group titles in lowercase.",
    type: ParameterType.Boolean,
    defaultValue: false,
  });
  const patterns = application.options.getValue("projectDocuments") as readonly string[];
  if (!hasDocumentGlob(patterns)) return;

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

  application.converter.on(
    Converter.EVENT_RESOLVE_BEGIN,
    (context) => {
      const lowercaseTitles =
        application.options.getValue("lowercaseDocumentGroupTitles") === true;
      const folders = new Map<string, DocumentReflection>();
      for (const [document, { directories, file }] of pending) {
        let parent: ProjectReflection | DocumentReflection = context.project;
        let key = "";
        for (const directory of directories) {
          key = key ? `${key}/${directory}` : directory;
          let folder = folders.get(key);
          if (!folder) {
            const name = directoryLabel(directory, lowercaseTitles);
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
    },
    1000,
  );

  application.converter.on(
    Converter.EVENT_RESOLVE_END,
    (context) => {
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
        const ordered = documents.filter((document) =>
          grouped.some((child) => child.id === document.id),
        );
        if (ordered.length === 0) continue;
        const ids = new Set(ordered.map((document) => document.id));
        grouped.splice(
          0,
          grouped.length,
          ...ordered,
          ...grouped.filter((child) => !ids.has(child.id)),
        );
      }
    },
    -1000,
  );
}
