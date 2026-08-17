import { Link } from "react-router";
import { PkgSwitcher, Cmd } from "~/components/PkgManager";
import { NpmVersions } from "~/components/NpmVersions";

const links = [
  ["Get started", [["install", "/install"], ["quickstart", "/quickstart"]]],
  ["Understand", [["philosophy", "/philosophy"], ["glossary", "/glossary"]]],
  ["Extend", [["extensions", "/extensions"], ["skills", "/skills"], ["commands", "/commands"]]],
  ["Reference", [["tools", "/tools"], ["providers", "/providers"], ["configuration", "/configuration"], ["extension API", "/api"]]],
  ["Help", [["troubleshooting", "/troubleshooting"], ["changelog", "/changelog"], ["github", "https://github.com/iceglober/glorious"]]],
] as const;

export function Home() {
  const copyBash = () => navigator.clipboard.writeText("curl -fsSL https://glrs.dev/install.sh | bash");
  return (
    <main className="home">
      <div className="home-hero">
        <h1>glorious</h1>
        <p className="tagline">a simple coding agent · minimal core · maximum extensibility</p>
      </div>
      <NpmVersions />
      <div className="install-block">
        <div className="install-cmd" onClick={copyBash} title="copy to clipboard">
          curl -fsSL https://glrs.dev/install.sh | bash
        </div>
        <div className="install-alt">
          <div className="install-or">or via package manager:</div>
          <div className="install-alt-row"><PkgSwitcher /><Cmd action="install" pkg="@glrs-dev/glorious@next" /></div>
        </div>
      </div>
      <hr />
      <div className="doc-map">
        {links.map(([heading, items]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            {items.map(([label, to]) => to.startsWith("http") ? <a key={to} href={to}>{label}</a> : <Link key={to} to={to}>{label}</Link>)}
          </section>
        ))}
      </div>
    </main>
  );
}
