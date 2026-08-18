import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnchorHeading } from "~/components/AnchorHeading";
import { useEditMode } from "~/components/EditMode";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Heading = { depth: 2 | 3; text: string; id: string; line: number };
type TemplateOption = { value: string; label: string; description: string };
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

export function Doc({ md, title, source }: { md: string; title: string; source?: string }) {
  const { editing, saveFile } = useEditMode();
  const [draft, setDraft] = useState(md);
  const [dirty, setDirty] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [suggestions, setSuggestions] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState(0);
  const [templateStart, setTemplateStart] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const shown = editing && source ? draft : md;
  const headings = headingsOf(shown);

  useEffect(() => {
    document.title = `${title} — glrs`;
  }, [title]);
  useEffect(() => {
    if (!dirty) setDraft(md);
  }, [md, dirty]);
  useEffect(() => {
    if (!editing || !source) return;
    void fetch("/__glorious_templates")
      .then((response) => response.json() as Promise<TemplateOption[]>)
      .then(setTemplates);
  }, [editing, source]);

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
    const match = /\{\{([^}\n]*)$/u.exec(value.slice(0, cursor));
    if (!match) {
      setSuggestions([]);
      setTemplateStart(null);
      return;
    }
    const query = match[1].toLowerCase();
    const found = templates.filter((option) => option.label.toLowerCase().includes(query));
    setTemplateStart(cursor - match[0].length);
    setSuggestions(found);
    setSelected(0);
  };

  const save = async () => {
    if (!source) return;
    await saveFile(source, `${draft.trimEnd()}\n`);
    setDirty(false);
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
          <div className="markdown-input">
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
              onKeyDown={(event) => {
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
              <div className="template-suggestions">
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
          <MarkdownBody markdown={draft} />
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
        <MarkdownBody markdown={md} />
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
