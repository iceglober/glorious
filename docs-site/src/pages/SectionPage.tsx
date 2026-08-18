import { useEffect } from "react";
import { Link } from "react-router";
import { EditableText, useEditMode } from "~/components/EditMode";

export function SectionPage({ sectionKey }: { sectionKey: string }) {
  const { content } = useEditMode();
  const sectionIndex = content.navigation.findIndex((entry) => entry.key === sectionKey);
  const section = content.navigation[sectionIndex];
  useEffect(() => {
    if (section) document.title = `${section.label} — glrs`;
  }, [section]);
  if (!section) return null;
  return (
    <main className="site-main section-page">
      <p className="eyebrow">
        <EditableText path="brand.name" /> / <EditableText path={`navigation.${sectionIndex}.label`} />
      </p>
      <h1>
        <EditableText path={`navigation.${sectionIndex}.label`} />
      </h1>
      <p className="section-intro">
        <EditableText path={`navigation.${sectionIndex}.intro`} />
      </p>
      <div className="section-links">
        {section.pages.map((page, pageIndex) => (
          <Link key={page.slug} to={`/${page.slug}`}>
            <strong>
              <EditableText path={`navigation.${sectionIndex}.pages.${pageIndex}.label`} />
            </strong>
            <span>Read the {page.label.toLowerCase()} documentation →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
