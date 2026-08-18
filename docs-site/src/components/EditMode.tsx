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

type EditContextValue = {
  editing: boolean;
  content: Content;
  text: (path: string) => string;
  change: (path: string, value: string) => void;
  saveFile: (file: string, content: string) => Promise<void>;
  addSection: () => void;
  addPage: (sectionIndex: number) => void;
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

export function EditModeProvider({ children }: { children: ReactNode }) {
  const editing = __GLORIOUS_EDIT__ && new URLSearchParams(window.location.search).has("edit");
  const [content, setContent] = useState<Content>(initial);
  const [status, setStatus] = useState("editor ready · double-click content");

  const saveFiles = async (files: Array<{ file: string; content: string }>) => {
    setStatus("saving…");
    const response = await fetch("/__glorious_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!response.ok) {
      setStatus(`save failed · ${await response.text()}`);
      return;
    }
    setStatus("saved to repo");
  };
  const siteFile = (next: Content) => ({
    file: "docs-site/src/content/site.json",
    content: `${JSON.stringify(next, null, 2)}\n`,
  });
  const saveFile = (file: string, body: string) => saveFiles([{ file, content: body }]);
  const change = (path: string, text: string) => {
    const next = writePath(content, path, text);
    setContent(next);
    void saveFiles([siteFile(next)]);
  };
  const addSection = () => {
    const label = window.prompt("Section name")?.trim();
    if (!label) return;
    const base = slugify(label) || "section";
    let key = base;
    let suffix = 2;
    while (content.navigation.some((section) => section.key === key)) key = `${base}-${suffix++}`;
    const next = structuredClone(content);
    next.navigation.push({ key, label, intro: "Describe this section.", pages: [] });
    setContent(next);
    void saveFiles([siteFile(next)]);
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

  return (
    <EditContext.Provider
      value={{
        editing,
        content,
        text: (path) => readPath(content, path),
        change,
        saveFile,
        addSection,
        addPage,
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

export function EditableText({ path, className }: { path: string; className?: string }) {
  const { editing, text, change } = useEditMode();
  const value = text(path);
  const [active, setActive] = useState(false);
  if (!editing) return <>{value}</>;
  return (
    <span
      className={`editable-text${active ? " editing" : ""}${className ? ` ${className}` : ""}`}
      contentEditable={active}
      suppressContentEditableWarning
      tabIndex={0}
      onClick={(event) => {
        if (active) event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setActive(true);
        queueMicrotask(() => event.currentTarget.focus());
      }}
      onBlur={(event) => {
        if (!active) return;
        setActive(false);
        const next = event.currentTarget.textContent ?? "";
        if (next !== value) change(path, next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.blur();
      }}
    >
      {value}
    </span>
  );
}
