import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { AnchorHeading } from "~/components/AnchorHeading";
import { useEditMode } from "~/components/EditMode";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Heading = { depth: 2 | 3; text: string; id: string; line: number };
const slug = (text: string) => text.toLowerCase().replace(/[`*_]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
const headingsOf = (md: string): Heading[] => {
  const used = new Map<string, number>();
  return md.split("\n").flatMap((line, index) => {
    const match = /^(##|###)\s+(.+)$/u.exec(line);
    if (!match) return [];
    const text = match[2].replace(/[`*_]/gu, "").trim();
    const base = slug(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return [{ depth: match[1].length as 2 | 3, text, id: count === 0 ? base : `${base}-${count}`, line: index + 1 }];
  });
};

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  return href?.startsWith("/") ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>;
}

export function Doc({ md, title, source }: { md: string; title: string; source?: string }) {
  const headings = headingsOf(md);
  const article = useRef<HTMLElement>(null);
  const beforeEdit = useRef("");
  const { editing, saveFile } = useEditMode();
  useEffect(() => {
    document.title = `${title} — glrs`;
    const hash = window.location.hash.slice(1);
    if (hash !== "") window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }, [title]);
  const jumpTo = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const activateBlock = (block: HTMLElement) => {
    if (!editing || !source) return;
    beforeEdit.current = article.current?.innerHTML ?? "";
    block.contentEditable = "true";
    block.classList.add("editing-block");
    block.focus();
  };
  const save = async () => {
    if (!editing || !source || !article.current) return;
    if (article.current.innerHTML === beforeEdit.current) return;
    const clone = article.current.cloneNode(true) as HTMLElement;
    for (const anchor of clone.querySelectorAll(".heading-anchor")) anchor.remove();
    const [{ default: TurndownService }, { gfm }] = await Promise.all([
      import("turndown"),
      import("turndown-plugin-gfm"),
    ]);
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    turndown.use(gfm);
    await saveFile(source, `${turndown.turndown(clone.innerHTML).trim()}\n`);
  };
  const headingId = (line: number | undefined) =>
    headings.find((heading) => heading.line === line)?.id ?? "section";
  return (
    <main className="site-main doc-layout">
      <article
        ref={article}
        className={`doc${editing && source ? " editable-document" : ""}`}
        onClick={(event) => {
          if (editing && (event.target as HTMLElement).closest("a")) event.preventDefault();
        }}
        onDoubleClick={(event) => {
          const block = (event.target as HTMLElement).closest<HTMLElement>(
            "h1,h2,h3,p,li,blockquote,pre,td,th",
          );
          if (block) activateBlock(block);
        }}
        onBlur={(event) => {
          const block = event.target as HTMLElement;
          if (!block.classList.contains("editing-block")) return;
          block.contentEditable = "false";
          block.classList.remove("editing-block");
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && (event.target as HTMLElement).classList.contains("editing-block"))
            (event.target as HTMLElement).blur();
        }}
      >
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
          {md}
        </Markdown>
      </article>
      {editing && source && (
        <button
          className="editor-action add-paragraph"
          type="button"
          onClick={() => {
            const before = article.current?.innerHTML ?? "";
            const paragraph = document.createElement("p");
            paragraph.textContent = "New paragraph.";
            article.current?.append(paragraph);
            activateBlock(paragraph);
            beforeEdit.current = before;
          }}
        >
          <span>+</span>
          <strong>Add Paragraph</strong>
        </button>
      )}
      {headings.length > 0 && (
        <aside className="on-page" contentEditable={false}>
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
