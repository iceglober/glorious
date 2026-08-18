import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnchorHeading } from "~/components/AnchorHeading";
import { useEditMode } from "~/components/EditMode";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Heading = { depth: 2 | 3; text: string; id: string; line: number };
type TemplateOption = {
  value: string;
  label: string;
  description: string;
  kind: "generated" | "asset";
};
type Point = { top: number; left: number };

const slug = (text: string) =>
  text.toLowerCase().replace(/[`*_]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
const headingsOf = (md: string): Heading[] => {
  const used = new Map<string, number>();
  return md.split("\n").flatMap((line, index) => {
    const match = /^(##|###)\s+(.+)$/u.exec(line);
    if (!match) return [];
    const text = match[2].replace(/[`*_]/gu, "").trim();
    const base = slug(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return [
      {
        depth: match[1].length as 2 | 3,
        text,
        id: count === 0 ? base : `${base}-${count}`,
        line: index + 1,
      },
    ];
  });
};

const caretPoint = (input: HTMLTextAreaElement, position: number): Point => {
  const style = getComputedStyle(input);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const rect = input.getBoundingClientRect();
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${input.clientWidth}px`,
    padding: style.padding,
    border: style.border,
    font: style.font,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    tabSize: style.tabSize,
  });
  mirror.textContent = input.value.slice(0, position);
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  return {
    top: markerRect.bottom - rect.top - input.scrollTop,
    left: markerRect.left - rect.left - input.scrollLeft,
  };
};

const highlighted = (source: string): ReactNode[] =>
  source.split("\n").flatMap((line, lineIndex) => {
    const parts = line.split(/(<\/?[A-Z][^>]*>|\{\{[^}]*\}\}|\*\*[^*]+\*\*|`[^`]+`)/gu);
    const content = parts.map((part, index) => {
      const className =
        /^<\/?[A-Z]/u.test(part) || /^\{\{/u.test(part)
          ? "md-template"
          : /^\*\*/u.test(part)
            ? "md-strong"
            : /^`/u.test(part)
              ? "md-code"
              : undefined;
      return className ? (
        <span className={className} key={`${lineIndex}-${index}`}>
          {part}
        </span>
      ) : (
        part
      );
    });
    return [
      <span className={/^#{1,6}\s/u.test(line) ? "md-heading" : undefined} key={lineIndex}>
        {content}
        {"\n"}
      </span>,
    ];
  });

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  return href?.startsWith("/") ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>;
}

function MarkdownBody({ markdown }: { markdown: string }) {
  const headings = headingsOf(markdown);
  const headingId = (line: number | undefined) =>
    headings.find((heading) => heading.line === line)?.id ?? "section";
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: MdLink,
        h2: ({ children, node }) => (
          <AnchorHeading level={2} id={headingId(node?.position?.start.line)}>
            {children}
          </AnchorHeading>
        ),
        h3: ({ children, node }) => (
          <AnchorHeading level={3} id={headingId(node?.position?.start.line)}>
            {children}
          </AnchorHeading>
        ),
      }}
    >
      {markdown}
    </Markdown>
  );
}

export function Doc({
  md,
  title,
  source,
  renderPreview,
}: {
  md: string;
  title: string;
  source?: string;
  renderPreview?: (source: string) => ReactNode;
}) {
  const { editing, saveFile, uploadAsset } = useEditMode();
  const [draft, setDraft] = useState(md);
  const [dirty, setDirty] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [suggestions, setSuggestions] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState(0);
  const [templateStart, setTemplateStart] = useState<number | null>(null);
  const [suggestionPoint, setSuggestionPoint] = useState<Point>({ top: 0, left: 0 });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const base = useRef(md);
  const shown = editing && source ? draft : md;
  const headings = headingsOf(shown);

  useEffect(() => {
    document.title = `${title} — glrs`;
  }, [title]);
  useEffect(() => {
    if (!dirty) {
      setDraft(md);
      base.current = md;
    }
  }, [md, dirty]);
  useEffect(() => {
    if (!editing || !source) return;
    void fetch("/__glorious_templates")
      .then((response) => response.json() as Promise<TemplateOption[]>)
      .then(setTemplates);
  }, [editing, source]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const followLink = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (link && !window.confirm("Discard unsaved Markdown changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const historyChange = () => {
      if (!window.confirm("Discard unsaved Markdown changes?")) window.history.forward();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", historyChange, true);
    document.addEventListener("click", followLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", historyChange, true);
      document.removeEventListener("click", followLink, true);
    };
  }, [dirty]);

  const replaceSelection = (before: string, after = before, placeholder = "text") => {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selectedText = draft.slice(start, end) || placeholder;
    const inserted = `${before}${selectedText}${after}`;
    const next = `${draft.slice(0, start)}${inserted}${draft.slice(end)}`;
    setDraft(next);
    setDirty(true);
    const selectionStart = start + before.length;
    queueMicrotask(() => {
      input.focus();
      input.setSelectionRange(selectionStart, selectionStart + selectedText.length);
    });
  };
  const prefixLines = (prefix: string) => {
    const input = textarea.current;
    if (!input) return;
    const start = draft.lastIndexOf("\n", input.selectionStart - 1) + 1;
    const endAt = draft.indexOf("\n", input.selectionEnd);
    const end = endAt < 0 ? draft.length : endAt;
    const replacement = draft
      .slice(start, end)
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
    setDraft(`${draft.slice(0, start)}${replacement}${draft.slice(end)}`);
    setDirty(true);
    queueMicrotask(() => input.focus());
  };
  const insertText = (text: string) => {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`;
    const cursor = start + text.length;
    setDraft(next);
    setDirty(true);
    queueMicrotask(() => {
      input.focus();
      input.setSelectionRange(cursor, cursor);
      if (text.endsWith("{{")) refreshSuggestions(next, cursor);
    });
  };
  const complete = (option: TemplateOption) => {
    const input = textarea.current;
    if (!input || templateStart === null) return;
    const cursor = input.selectionStart;
    const next = `${draft.slice(0, templateStart)}${option.value}${draft.slice(cursor)}`;
    const nextCursor = templateStart + option.value.length;
    setDraft(next);
    setDirty(true);
    setSuggestions([]);
    setTemplateStart(null);
    queueMicrotask(() => input.setSelectionRange(nextCursor, nextCursor));
  };
  const refreshSuggestions = (value: string, cursor: number) => {
    const input = textarea.current;
    const match = /\{\{([^}\n]*)$/u.exec(value.slice(0, cursor));
    if (!match || !input) {
      setSuggestions([]);
      setTemplateStart(null);
      return;
    }
    const query = match[1].toLowerCase();
    const found = templates.filter((option) => option.label.toLowerCase().includes(query));
    setTemplateStart(cursor - match[0].length);
    setSuggestions(found);
    setSuggestionPoint(caretPoint(input, cursor));
    setSelected(0);
  };
  const save = async () => {
    if (!source) return;
    const body = `${draft.trimEnd()}\n`;
    const outcome = await saveFile(source, body, base.current);
    if (outcome === "saved") {
      base.current = body;
      setDraft(body);
      setDirty(false);
    }
  };

  if (editing && source)
    return (
      <main className="site-main markdown-editor">
        <section className="markdown-source">
          <header>
            <strong>Markdown</strong>
            <span>{source}</span>
            <button type="button" disabled={!dirty} onClick={() => void save()}>
              {dirty ? "Save" : "Saved"}
            </button>
          </header>
          <div className="markdown-toolbar" aria-label="Markdown formatting">
            <button type="button" title="Heading 2" onClick={() => prefixLines("## ")}>H2</button>
            <button type="button" title="Heading 3" onClick={() => prefixLines("### ")}>H3</button>
            <button type="button" title="Bold (Cmd/Ctrl+B)" onClick={() => replaceSelection("**")}>B</button>
            <button type="button" title="Italic (Cmd/Ctrl+I)" onClick={() => replaceSelection("_")}>I</button>
            <button type="button" title="Inline code" onClick={() => replaceSelection("`")}>{"<>"}</button>
            <button type="button" title="Link (Cmd/Ctrl+K)" onClick={() => replaceSelection("[", "](https://)")}>Link</button>
            <button type="button" title="Bulleted list" onClick={() => prefixLines("- ")}>List</button>
            <button type="button" title="Quote" onClick={() => prefixLines("> ")}>Quote</button>
            <button type="button" title="Template" onClick={() => insertText("{{")}>{"{{"}</button>
            <button type="button" title="Upload asset" onClick={() => assetInput.current?.click()}>Asset</button>
            <input
              ref={assetInput}
              hidden
              type="file"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                void uploadAsset(file).then((directive) => {
                  if (directive) insertText(directive);
                  input.value = "";
                });
              }}
            />
          </div>
          <div className="markdown-input">
            <pre ref={highlight} className="markdown-highlight" aria-hidden="true">
              {highlighted(draft)}
            </pre>
            <textarea
              ref={textarea}
              aria-label={`Edit ${title} Markdown`}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
                refreshSuggestions(event.target.value, event.target.selectionStart);
              }}
              onClick={(event) =>
                refreshSuggestions(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onScroll={(event) => {
                if (!highlight.current) return;
                highlight.current.scrollTop = event.currentTarget.scrollTop;
                highlight.current.scrollLeft = event.currentTarget.scrollLeft;
              }}
              spellCheck={false}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
                  event.preventDefault();
                  replaceSelection("**");
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
                  event.preventDefault();
                  replaceSelection("_");
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                  event.preventDefault();
                  replaceSelection("[", "](https://)");
                  return;
                }
                if (suggestions.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelected((index) => (index + 1) % suggestions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelected((index) => (index + suggestions.length - 1) % suggestions.length);
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    complete(suggestions[selected]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSuggestions([]);
                    return;
                  }
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            {suggestions.length > 0 && (
              <div
                className="template-suggestions"
                style={{ top: suggestionPoint.top, left: suggestionPoint.left }}
              >
                {suggestions.map((option, index) => (
                  <button
                    className={index === selected ? "selected" : ""}
                    key={option.value}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      complete(option);
                    }}
                  >
                    <strong>{option.value}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        <article className="doc markdown-preview">
          {renderPreview ? renderPreview(draft) : <MarkdownBody markdown={draft} />}
        </article>
      </main>
    );

  const jumpTo = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <main className="site-main doc-layout">
      <article className="doc">
        {renderPreview ? renderPreview(md) : <MarkdownBody markdown={md} />}
      </article>
      {headings.length > 0 && (
        <aside className="on-page">
          <strong>On this page</strong>
          <nav>
            {headings.map(({ depth, text, id }) => (
              <a
                className={depth === 3 ? "nested" : ""}
                key={id}
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  jumpTo(id);
                }}
              >
                {text}
              </a>
            ))}
          </nav>
        </aside>
      )}
    </main>
  );
}
