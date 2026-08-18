import { createContext, useContext, useState, type ReactNode } from "react";
import initial from "~/content/site.json";

declare const __GLORIOUS_EDIT__: boolean;

type Content = typeof initial;
type EditContextValue = {
  editing: boolean;
  content: Content;
  text: (path: string) => string;
  change: (path: string, value: string) => void;
  saveFile: (file: string, content: string) => Promise<void>;
};

const EditContext = createContext<EditContextValue | null>(null);

const readPath = (value: unknown, path: string): string => {
  let current = value;
  for (const part of path.split("."))
    current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[part] : undefined;
  return typeof current === "string" ? current : "";
};

const writePath = (value: Content, path: string, text: string): Content => {
  const clone = structuredClone(value) as Record<string, unknown>;
  const parts = path.split(".");
  let current = clone;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1) ?? ""] = text;
  return clone as Content;
};

export function EditModeProvider({ children }: { children: ReactNode }) {
  const editing = __GLORIOUS_EDIT__ && new URLSearchParams(window.location.search).has("edit");
  const [content, setContent] = useState<Content>(initial);
  const [status, setStatus] = useState("editing locally · saves on blur");
  const saveFile = async (file: string, body: string) => {
    setStatus("saving…");
    const response = await fetch("/__glorious_edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, content: body }),
    });
    if (!response.ok) {
      setStatus(`save failed · ${await response.text()}`);
      return;
    }
    setStatus("saved to repo");
  };
  const change = (path: string, text: string) => {
    const next = writePath(content, path, text);
    setContent(next);
    void saveFile("docs-site/src/content/site.json", `${JSON.stringify(next, null, 2)}\n`);
  };
  return (
    <EditContext.Provider value={{ editing, content, text: (path) => readPath(content, path), change, saveFile }}>
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
  if (!editing) return <>{value}</>;
  return (
    <span
      className={`editable-text${className ? ` ${className}` : ""}`}
      contentEditable
      suppressContentEditableWarning
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onBlur={(event) => {
        const next = event.currentTarget.textContent ?? "";
        if (next !== value) change(path, next);
      }}
    >
      {value}
    </span>
  );
}
