import { useEffect } from "react";
import { Cmd, PkgSwitcher } from "~/components/PkgManager";
import { CodeBlock } from "~/components/CodeBlock";
import { AnchorHeading } from "~/components/AnchorHeading";

export function Install() {
  useEffect(() => {
    document.title = "Install — glrs";
  }, []);

  return (
    <main className="site-main doc">
      <h1>Install</h1>

      <AnchorHeading level={2} id="recommended">Recommended</AnchorHeading>

      <CodeBlock copy="curl -fsSL https://glrs.dev/install.sh | bash">
        curl -fsSL https://glrs.dev/install.sh | bash
      </CodeBlock>

      <AnchorHeading level={2} id="manual">Manual</AnchorHeading>

      <p>
        Requires <a href="https://bun.sh">Bun</a> ≥ 1.2 and git.
      </p>

      <CodeBlock copy="bun add --global @glrs-dev/glorious@next">
        bun add --global @glrs-dev/glorious@next
      </CodeBlock>

      <div className="pkg-bar">
        <PkgSwitcher />
      </div>

      <pre>
        <code>
          <Cmd action="install" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>

      <AnchorHeading level={2} id="first-run">First run</AnchorHeading>

      <pre>
        <code>
          export AZURE_OPENAI_API_KEY=…{"\n"}
          export AZURE_RESOURCE_NAME=…{"\n"}
          glorious
        </code>
      </pre>

      <p>
        See the <a href="/quickstart">quickstart</a>.
      </p>

      <AnchorHeading level={2} id="update">Update</AnchorHeading>

      <pre>
        <code>
          <Cmd action="install" pkg="@glrs-dev/glorious@next" />
        </code>
      </pre>

      <AnchorHeading level={2} id="uninstall">Uninstall</AnchorHeading>

      <pre>
        <code>
          <Cmd action="remove" pkg="@glrs-dev/glorious" />
        </code>
      </pre>
    </main>
  );
}
