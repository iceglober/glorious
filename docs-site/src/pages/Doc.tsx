import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { AnchorHeading } from "~/components/AnchorHeading";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Heading = { depth: 2 | 3; text: string; id: string };
const slug = (text: string) => text.toLowerCase().replace(/[`*_]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
const headingsOf = (md: string): Heading[] => {
  const used = new Map<string, number>();
  return md.split("\n").flatMap((line) => {
    const match = /^(##|###)\s+(.+)$/u.exec(line);
    if (!match) return [];
    const text = match[2].replace(/[`*_]/gu, "").trim();
    const base = slug(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return [{ depth: match[1].length as 2 | 3, text, id: count === 0 ? base : `${base}-${count}` }];
  });
};

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  return href?.startsWith("/") ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>;
}

export function Doc({ md, title }: { md: string; title: string }) {
  const headings = headingsOf(md);
  useEffect(() => {
    document.title = `${title} — glrs`;
    const hash = window.location.hash.slice(1);
    if (hash !== "") window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }, [title]);
  const jumpTo = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const seen = new Map<string, number>();
  const headingId = (children: ReactNode) => {
    const base = slug(String(children));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
  return (
    <main className="site-main doc-layout">
      <article className="doc">
        <Markdown remarkPlugins={[remarkGfm]} components={{
          a: MdLink,
          h1: ({ children }) => <AnchorHeading level={1} id={headingId(children)}>{children}</AnchorHeading>,
          h2: ({ children }) => <AnchorHeading level={2} id={headingId(children)}>{children}</AnchorHeading>,
          h3: ({ children }) => <AnchorHeading level={3} id={headingId(children)}>{children}</AnchorHeading>,
        }}>{md}</Markdown>
      </article>
      {headings.length > 0 && <aside className="on-page"><strong>On this page</strong><nav>{headings.map(({ depth, text, id }) => <a className={depth === 3 ? "nested" : ""} key={id} href={`#${id}`} onClick={(event) => { event.preventDefault(); jumpTo(id); }}>{text}</a>)}</nav></aside>}
    </main>
  );
}
