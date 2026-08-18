import { useEffect } from "react";
import { AnchorHeading } from "~/components/AnchorHeading";
import { CodeBlock } from "~/components/CodeBlock";
import { useEditMode } from "~/components/EditMode";
import { Cmd, PkgSwitcher } from "~/components/PkgManager";

export function Install() {
  const { content } = useEditMode();
  const sectionIndex = content.navigation.findIndex((section) =>
    section.pages.some((page) => page.kind === "install"),
  );
  const pageIndex = content.navigation[sectionIndex]?.pages.findIndex(
    (page) => page.kind === "install",
  );
  const title = content.navigation[sectionIndex]?.pages[pageIndex ?? -1]?.label ?? "Install";
  useEffect(() => {
    document.title = "Install — glrs";
  }, []);

  return (
    <main className="site-main doc">
      <h1>{title}</h1>
      <div className="pkg-bar install-switcher">
        <PkgSwitcher />
      </div>
      <AnchorHeading level={2} id="recommended">
        {content.install.recommended}
      </AnchorHeading>
      <CodeBlock copy="curl -fsSL https://glrs.dev/install.sh | bash">
        curl -fsSL https://glrs.dev/install.sh | bash
      </CodeBlock>
      <AnchorHeading level={2} id="manual">
        {content.install.manual}
      </AnchorHeading>
      <p>
        {content.install.requirements}
      </p>
      <CodeBlock copy="bun add --global @glrs-dev/glorious@next">
        bun add --global @glrs-dev/glorious@next
      </CodeBlock>
      <pre>
        <code>
          <Cmd action="install" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>
      <AnchorHeading level={2} id="first-run">
        {content.install.firstRun}
      </AnchorHeading>
      <pre>
        <code>
          export AZURE_OPENAI_API_KEY=…{"\n"}
          export AZURE_RESOURCE_NAME=…{"\n"}
          glorious
        </code>
      </pre>
      <p>
        <a href="/quickstart">
          {content.install.quickstart}
        </a>
      </p>
      <AnchorHeading level={2} id="update">
        {content.install.update}
      </AnchorHeading>
      <pre>
        <code>
          <Cmd action="install" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>
      <AnchorHeading level={2} id="uninstall">
        {content.install.uninstall}
      </AnchorHeading>
      <pre>
        <code>
          <Cmd action="remove" pkg="@glrs-dev/glorious" />
        </code>
      </pre>
    </main>
  );
}
