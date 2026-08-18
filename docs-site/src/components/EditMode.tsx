import { createContext, useContext, useState, type ReactNode } from "react";
import initialJson from "~/content/site.json";

declare const __GLORIOUS_EDIT__: boolean;

export type NavigationPage = {
  key: string;
  label: string;
  slug: string;
  kind: "markdown" | "install" | "generated" | "changelog";
};
export type NavigationSection = {
  key: string;
  label: string;
  intro: string;
  pages: NavigationPage[];
};
type Content = Omit<typeof initialJson, "navigation"> & { navigation: NavigationSection[] };
const initial = initialJson as Content;

type SaveOutcome = "saved" | "conflict" | "failed";
type EditContextValue = {
  editing: boolean;
  content: Content;
  text: (path: string) => string;
  change: (path: string, value: string) => void;
  saveFile: (file: string, content: string, expected?: string) => Promise<SaveOutcome>;
  uploadAsset: (file: File) => Promise<string | null>;
  addSection: () => void;
  addPage: (sectionIndex: number) => void;
  moveSection: (sectionIndex: number, direction: -1 | 1) => void;
  movePage: (sectionIndex: number, pageIndex: number, direction: -1 | 1) => void;
  removeSection: (sectionIndex: number) => void;
  removePage: (sectionIndex: number, pageIndex: number) => void;
};

const EditContext = createContext<EditContextValue | null>(null);
const slugify = (text: string) =>
  text.toLowerCase().trim().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

const readPath = (value: unknown, path: string): string => {
  let current = value;
  for (const part of path.split("."))
    current =
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)[part]
        : undefined;
  return typeof current === "string" ? current : "";
};

const writePath = (value: Content, path: string, text: string): Content => {
  const clone = structuredClone(value) as unknown as Record<string, unknown>;
  const parts = path.split(".");
  let current = clone;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1) ?? ""] = text;
  return clone as unknown as Content;
};

const dataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function EditModeProvider({ children }: { children: ReactNode }) {
  const editing = __GLORIOUS_EDIT__;
  const [content, setContent] = useState<Content>(initial);
  const [status, setStatus] = useState("editor ready · Markdown saves explicitly");

  const saveFiles = async (
    files: Array<{ file: string; content: string; expected?: string }>,
    remove: string[] = [],
  ): Promise<SaveOutcome> => {
    setStatus("saving…");
    const response = await fetch("/__glorious_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, remove }),
    });
    if (response.status === 409) {
      setStatus("save blocked · file changed on disk");
      return "conflict";
    }
    if (!response.ok) {
      setStatus(`save failed · ${await response.text()}`);
      return "failed";
    }
    setStatus("saved to repo");
    return "saved";
  };
  const siteFile = (next: Content) => ({
    file: "docs-site/src/content/site.json",
    content: `${JSON.stringify(next, null, 2)}\n`,
  });
  const saveContent = (next: Content, remove: string[] = []) => {
    setContent(next);
    void saveFiles([siteFile(next)], remove);
  };
  const saveFile = (file: string, body: string, expected?: string) =>
    saveFiles([{ file, content: body, expected }]);
  const change = (path: string, value: string) => saveContent(writePath(content, path, value));

  const addSection = () => {
    const label = window.prompt("Section name")?.trim();
    if (!label) return;
    const base = slugify(label) || "section";
    let key = base;
    let suffix = 2;
    while (content.navigation.some((section) => section.key === key)) key = `${base}-${suffix++}`;
    const next = structuredClone(content);
    next.navigation.push({ key, label, intro: "Describe this section.", pages: [] });
    saveContent(next);
  };
  const addPage = (sectionIndex: number) => {
    const label = window.prompt("Page title")?.trim();
    if (!label) return;
    const suggested = slugify(label) || "page";
    const slug = window.prompt("Page URL slug", suggested)?.trim();
    if (!slug || !/^[a-z0-9-]+$/u.test(slug)) {
      setStatus("page not created · use lowercase letters, numbers, and hyphens");
      return;
    }
    if (content.navigation.some((section) => section.pages.some((page) => page.slug === slug))) {
      setStatus(`page not created · /${slug} already exists`);
      return;
    }
    const next = structuredClone(content);
    next.navigation[sectionIndex]?.pages.push({ key: slug, label, slug, kind: "markdown" });
    setContent(next);
    void saveFiles([
      siteFile(next),
      { file: `docs/published/${slug}.md`, content: `# ${label}\n\nNew page.\n` },
    ]);
  };
  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= content.navigation.length) return;
    const next = structuredClone(content);
    [next.navigation[index], next.navigation[target]] = [
      next.navigation[target],
      next.navigation[index],
    ];
    saveContent(next);
  };
  const movePage = (sectionIndex: number, pageIndex: number, direction: -1 | 1) => {
    const pages = content.navigation[sectionIndex]?.pages;
    const target = pageIndex + direction;
    if (!pages || target < 0 || target >= pages.length) return;
    const next = structuredClone(content);
    const nextPages = next.navigation[sectionIndex].pages;
    [nextPages[pageIndex], nextPages[target]] = [nextPages[target], nextPages[pageIndex]];
    saveContent(next);
  };
  const removePage = (sectionIndex: number, pageIndex: number) => {
    const page = content.navigation[sectionIndex]?.pages[pageIndex];
    if (!page || !window.confirm(`Delete page “${page.label}”?`)) return;
    const next = structuredClone(content);
    next.navigation[sectionIndex].pages.splice(pageIndex, 1);
    const remove = page.kind === "markdown" ? [`docs/published/${page.slug}.md`] : [];
    saveContent(next, remove);
  };
  const removeSection = (sectionIndex: number) => {
    const section = content.navigation[sectionIndex];
    if (!section || !window.confirm(`Delete section “${section.label}” and its pages?`)) return;
    const next = structuredClone(content);
    next.navigation.splice(sectionIndex, 1);
    saveContent(
      next,
      section.pages
        .filter((page) => page.kind === "markdown")
        .map((page) => `docs/published/${page.slug}.md`),
    );
  };
  const uploadAsset = async (file: File): Promise<string | null> => {
    setStatus("uploading asset…");
    const response = await fetch("/__glorious_assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, data: await dataUrl(file) }),
    });
    if (!response.ok) {
      setStatus(`upload failed · ${await response.text()}`);
      return null;
    }
    const result = (await response.json()) as { directive: string };
    setStatus("asset saved to repo");
    return result.directive;
  };

  return (
    <EditContext.Provider
      value={{
        editing,
        content,
        text: (path) => readPath(content, path),
        change,
        saveFile,
        uploadAsset,
        addSection,
        addPage,
        moveSection,
        movePage,
        removeSection,
        removePage,
      }}
    >
      {editing && <div className="edit-mode-status">{status}</div>}
      {children}
    </EditContext.Provider>
  );
}

export function useEditMode(): EditContextValue {
  const value = useContext(EditContext);
  if (!value) throw new Error("useEditMode must be used inside EditModeProvider");
  return value;
}
