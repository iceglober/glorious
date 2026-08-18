import { useEffect } from "react";
import { Link } from "react-router";
import { EditableText, useEditMode } from "~/components/EditMode";
import { SECTIONS } from "~/navigation";

export function SectionPage({ path }: { path: string }) {
  const section = SECTIONS.find(({ to }) => to === path);
  const { text } = useEditMode();
  const label = section ? text(`sections.${section.key}.label`) : "";
  useEffect(() => {
    if (section) document.title = `${label} — glrs`;
  }, [section, label]);
  if (!section) return null;
  return (
    <main className="site-main section-page">
      <p className="eyebrow">
        <EditableText path="brand.name" /> / <EditableText path={`sections.${section.key}.label`} />
      </p>
      <h1>
        <EditableText path={`sections.${section.key}.label`} />
      </h1>
      <p className="section-intro">
        <EditableText path={`sections.${section.key}.intro`} />
      </p>
      <div className="section-links">
        {section.pages.map((page) => (
          <Link key={page.to} to={page.to}>
            <strong>
              <EditableText path={`pages.${page.key}`} />
            </strong>
            <span>Read the {text(`pages.${page.key}`).toLowerCase()} documentation →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
