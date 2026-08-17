import { Link } from "react-router";
import { SECTIONS } from "~/components/Layout";

const INTRO: Record<string, string> = {
  "/get-started": "Install glorious, configure a provider, and make your first useful turn.",
  "/concepts": "The language and design commitments behind glorious.",
  "/extend": "Add tools, commands, skills, and behavior without forking the core.",
  "/reference": "The complete reference for daily use and extension authors.",
  "/help": "Diagnose setup problems and follow what changed.",
};

export function SectionPage({ path }: { path: string }) {
  const section = SECTIONS.find(({ to }) => to === path);
  if (!section) return null;
  return (
    <main className="site-main section-page">
      <p className="eyebrow">glorious / {section.label}</p>
      <h1>{section.label}</h1>
      <p className="section-intro">{INTRO[path]}</p>
      <div className="section-links">
        {section.pages.map(([label, to]) => <Link key={to} to={to}><strong>{label}</strong><span>Read the {label.toLowerCase()} documentation →</span></Link>)}
      </div>
    </main>
  );
}
