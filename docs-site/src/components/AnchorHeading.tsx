import type { ReactNode } from "react";

type Level = 1 | 2 | 3;

export function AnchorHeading({ level, id, children }: { level: Level; id: string; children: ReactNode }) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return <Tag id={id}>{children}{" "}<a className="heading-anchor" href={`#${id}`} aria-label={`Link to ${String(children)}`}>#</a></Tag>;
}
