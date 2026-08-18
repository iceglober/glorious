import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { MdxPreview } from "~/components/MdxPreview";
import { useEditMode } from "~/components/EditMode";
import { PkgSwitcher, Cmd } from "~/components/PkgManager";
import { NpmVersions } from "~/components/NpmVersions";
import { Doc } from "./Doc";

export function Home({ source }: { source: string }) {
  useEffect(() => {
    document.title = "glorious — glrs";
  }, []);
  const { content, editing } = useEditMode();
  const components = {
    HomeHero: ({ children }: { children: ReactNode }) => <div className="home-hero">{children}</div>,
    NpmVersions,
    InstallBlock: () => {
      const copy = () => navigator.clipboard.writeText("curl -fsSL https://glrs.dev/install.sh | bash");
      return (
        <div className="install-block">
          <div className="install-cmd" onClick={copy} title="copy to clipboard">
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
      );
    },
    SectionLinks: () => (
      <div className="doc-map">
        {content.navigation.map((section) => (
          <Link key={section.key} to={`/${section.key}`}>
            <strong>{section.label}</strong>
            <span>{content.home.browse}</span>
          </Link>
        ))}
      </div>
    ),
  };
  const preview = (mdx: string) => <MdxPreview source={mdx} components={components} />;
  return editing ? (
    <Doc md={source} title="Home" source="docs-site/src/content/home.mdx" renderPreview={preview} />
  ) : (
    <main className="home">{preview(source)}</main>
  );
}
