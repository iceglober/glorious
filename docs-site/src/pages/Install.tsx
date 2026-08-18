import { useEffect } from "react";
import { MdxPreview } from "~/components/MdxPreview";
import { useEditMode } from "~/components/EditMode";
import { Cmd, PkgSwitcher } from "~/components/PkgManager";
import { Doc } from "./Doc";

export function Install({ source }: { source: string }) {
  useEffect(() => {
    document.title = "Install — glrs";
  }, []);
  const { editing } = useEditMode();
  const components = {
    PackageSwitcher: () => (
      <div className="pkg-bar install-switcher">
        <PkgSwitcher />
      </div>
    ),
    PackageInstall: () => (
      <pre>
        <code>
          <Cmd action="install" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>
    ),
    PackageUpdate: () => (
      <pre>
        <code>
          <Cmd action="update" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>
    ),
    PackageRemove: () => (
      <pre>
        <code>
          <Cmd action="remove" pkg="@glrs-dev/glorious" />
        </code>
      </pre>
    ),
  };
  const preview = (mdx: string) => <MdxPreview source={mdx} components={components} />;
  return editing ? (
    <Doc
      md={source}
      title="Install"
      source="docs-site/src/content/install.mdx"
      renderPreview={preview}
    />
  ) : (
    <main className="site-main doc">{preview(source)}</main>
  );
}
