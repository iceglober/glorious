import { useEffect } from "react";
import { AnchorHeading } from "~/components/AnchorHeading";
import { CodeBlock } from "~/components/CodeBlock";
import { EditableText } from "~/components/EditMode";
import { Cmd, PkgSwitcher } from "~/components/PkgManager";

export function Install() {
  useEffect(() => {
    document.title = "Install — glrs";
  }, []);

  return (
    <main className="site-main doc">
      <h1>
        <EditableText path="pages.install" />
      </h1>
      <div className="pkg-bar install-switcher">
        <PkgSwitcher />
      </div>
      <AnchorHeading level={2} id="recommended">
        <EditableText path="install.recommended" />
      </AnchorHeading>
      <CodeBlock copy="curl -fsSL https://glrs.dev/install.sh | bash">
        curl -fsSL https://glrs.dev/install.sh | bash
      </CodeBlock>
      <AnchorHeading level={2} id="manual">
        <EditableText path="install.manual" />
      </AnchorHeading>
      <p>
        <EditableText path="install.requirements" />
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
        <EditableText path="install.firstRun" />
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
          <EditableText path="install.quickstart" />
        </a>
      </p>
      <AnchorHeading level={2} id="update">
        <EditableText path="install.update" />
      </AnchorHeading>
      <pre>
        <code>
          <Cmd action="install" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>
      <AnchorHeading level={2} id="uninstall">
        <EditableText path="install.uninstall" />
      </AnchorHeading>
      <pre>
        <code>
          <Cmd action="remove" pkg="@glrs-dev/glorious" />
        </code>
      </pre>
    </main>
  );
}
