import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnchorHeading } from "~/components/AnchorHeading";
import { useEditMode } from "~/components/EditMode";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Heading = { depth: 2 | 3; text: string; id: string; line: number };
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
  const shown = editing && source ? draft : md;
  const headings = headingsOf(shown);

  useEffect(() => {
    document.title = `${title} — glrs`;
  }, [title]);
  useEffect(() => {
    if (!dirty) setDraft(md);
  }, [md, dirty]);

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
          <textarea
            aria-label={`Edit ${title} Markdown`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDirty(true);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                event.preventDefault();
                void save();
              }
            }}
          />
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
