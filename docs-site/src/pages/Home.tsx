import { useEffect } from "react";
import { Link } from "react-router";
import { useEditMode } from "~/components/EditMode";
import { PkgSwitcher, Cmd } from "~/components/PkgManager";
import { NpmVersions } from "~/components/NpmVersions";

export function Home() {
  useEffect(() => {
    document.title = "glorious — glrs";
  }, []);
  const { content } = useEditMode();
  const copyBash = () => navigator.clipboard.writeText("curl -fsSL https://glrs.dev/install.sh | bash");
  return (
    <main className="home">
      <div className="home-hero">
        <h1>{content.brand.name}</h1>
        <p className="tagline">{content.brand.tagline}</p>
      </div>
      <NpmVersions />
      <div className="install-block">
        <div className="install-cmd" onClick={copyBash} title="copy to clipboard">
          curl -fsSL https://glrs.dev/install.sh | bash
        </div>
        <div className="install-alt">
          <div className="install-or">{content.home.packageAlternative}</div>
          <div className="install-alt-row">
            <PkgSwitcher />
            <Cmd action="install" pkg="@glrs-dev/glorious@next" />
          </div>
        </div>
      </div>
      <hr />
      <div className="doc-map">
        {content.navigation.map((section) => (
          <Link key={section.key} to={`/${section.key}`}>
            <strong>{section.label}</strong>
            <span>{content.home.browse}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
