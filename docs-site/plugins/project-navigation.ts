import { resolve } from "node:path";
import {
  Application,
  Converter,
  DocumentReflection,
  ParameterType,
  type ProjectReflection,
  type Reflection,
} from "typedoc";

export const DOCUMENTATION_PROJECTS_OPTION = "documentationProjects";

export type DocumentationProjectNavigation = {
  label: string;
  root: string;
  entryPoints: readonly string[];
};

const owners = new WeakMap<Reflection, string>();

export const documentationProjects = (value: unknown): DocumentationProjectNavigation[] => {
  if (!Array.isArray(value)) throw new Error(`${DOCUMENTATION_PROJECTS_OPTION} must be an array`);
  return value.map((entry, at) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new Error(`${DOCUMENTATION_PROJECTS_OPTION}[${at}] must be an object`);
    const raw = entry as Record<string, unknown>;
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const root = typeof raw.root === "string" ? resolve(raw.root) : "";
    const entryPoints = Array.isArray(raw.entryPoints)
      ? raw.entryPoints
          .filter((item): item is string => typeof item === "string")
          .map((item) => resolve(item))
      : [];
    if (label === "") throw new Error(`${DOCUMENTATION_PROJECTS_OPTION}[${at}].label is required`);
    if (root === "") throw new Error(`${DOCUMENTATION_PROJECTS_OPTION}[${at}].root is required`);
    return { label, root, entryPoints };
  });
};

export const navigationOwner = (reflection: Reflection): string | undefined =>
  owners.get(reflection);

const sourceFiles = (reflection: Reflection): string[] =>
  (
    reflection as Reflection & {
      sources?: readonly { fullFileName?: string }[];
    }
  ).sources?.flatMap((source) =>
    source.fullFileName ? [resolve(source.fullFileName)] : [],
  ) ?? [];

const inside = (file: string, root: string): boolean => file === root || file.startsWith(`${root}/`);

const assignParents = (reflection: Reflection): string | undefined => {
  const children = reflection instanceof DocumentReflection ? (reflection.children ?? []) : [];
  const labels = new Set(children.map(assignParents).filter((one): one is string => one !== undefined));
  const own = owners.get(reflection);
  if (own !== undefined) return own;
  if (labels.size === 1) {
    const [label] = labels;
    owners.set(reflection, label);
    return label;
  }
  return undefined;
};

export function load(application: Application): void {
  application.options.addDeclaration({
    name: DOCUMENTATION_PROJECTS_OPTION,
    help: "Project labels and source roots used to group the global navigation.",
    type: ParameterType.Mixed,
    defaultValue: [],
  });

  const configured = (): DocumentationProjectNavigation[] =>
    documentationProjects(application.options.getValue(DOCUMENTATION_PROJECTS_OPTION));

  application.converter.on(
    Converter.EVENT_CREATE_DOCUMENT,
    (_context: undefined, document: DocumentReflection) => {
      const file = document.project.files.getReflectionPath(document);
      if (!file) return;
      const project = configured().find((candidate) => inside(resolve(file), candidate.root));
      if (project) owners.set(document, project.label);
    },
  );

  application.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const projects = configured();
    for (const child of context.project.children ?? []) {
      const files = sourceFiles(child);
      const project = projects.find((candidate) =>
        files.some((file) => candidate.entryPoints.includes(file) || inside(file, candidate.root)),
      );
      if (project) owners.set(child, project.label);
    }
    for (const document of context.project.documents ?? []) assignParents(document);
  });
}
