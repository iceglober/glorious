import { useEffect } from "react";
import { Link } from "react-router";
import { useEditMode } from "~/components/EditMode";

export function SectionPage({ sectionKey }: { sectionKey: string }) {
  const { content } = useEditMode();
  const section = content.navigation.find((entry) => entry.key === sectionKey);
  useEffect(() => {
    if (section) document.title = `${section.label} — glrs`;
  }, [section]);
  if (!section) return null;
  return (
    <main className="site-main section-page">
      <p className="eyebrow">
        {content.brand.name} / {section.label}
      </p>
      <h1>{section.label}</h1>
      <p className="section-intro">{section.intro}</p>
      <div className="section-links">
        {section.pages.map((page) => (
          <Link key={page.slug} to={`/${page.slug}`}>
            <strong>{page.label}</strong>
            <span>Read the {page.label.toLowerCase()} documentation →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
