import { useEffect } from "react";
import { Link } from "react-router";
import { EditableText } from "~/components/EditMode";
import { SECTIONS } from "~/navigation";
import { PkgSwitcher, Cmd } from "~/components/PkgManager";
import { NpmVersions } from "~/components/NpmVersions";

export function Home() {
  useEffect(() => {
    document.title = "glorious — glrs";
  }, []);
  const copyBash = () => navigator.clipboard.writeText("curl -fsSL https://glrs.dev/install.sh | bash");
  return (
    <main className="home">
      <div className="home-hero">
        <h1>
          <EditableText path="brand.name" />
        </h1>
        <p className="tagline">
          <EditableText path="brand.tagline" />
        </p>
      </div>
      <NpmVersions />
      <div className="install-block">
        <div className="install-cmd" onClick={copyBash} title="copy to clipboard">
          curl -fsSL https://glrs.dev/install.sh | bash
        </div>
        <div className="install-alt">
          <div className="install-or">
            <EditableText path="home.packageAlternative" />
          </div>
          <div className="install-alt-row">
            <PkgSwitcher />
            <Cmd action="install" pkg="@glrs-dev/glorious@next" />
          </div>
        </div>
      </div>
      <hr />
      <div className="doc-map">
        {SECTIONS.map((section) => (
          <Link key={section.to} to={section.to}>
            <strong>
              <EditableText path={`sections.${section.key}.label`} />
            </strong>
            <span>
              <EditableText path="home.browse" />
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
