import { useEffect } from "react";
import { Link } from "react-router";
import { PkgSwitcher, Cmd } from "~/components/PkgManager";
import { NpmVersions } from "~/components/NpmVersions";

const links = [
  ["Get started", "/get-started"],
  ["Concepts", "/concepts"],
  ["Extend", "/extend"],
  ["Reference", "/reference"],
  ["Help", "/help"],
] as const;

export function Home() {
  useEffect(() => { document.title = "glrs — glrs"; }, []);
  const copyBash = () => navigator.clipboard.writeText("curl -fsSL https://glrs.dev/install.sh | bash");
  return (
    <main className="home">
      <div className="home-hero"><h1>glrs</h1><p className="tagline">a simple coding agent · minimal core · maximum extensibility</p></div>
      <NpmVersions />
      <div className="install-block">
        <div className="install-cmd" onClick={copyBash} title="copy to clipboard">curl -fsSL https://glrs.dev/install.sh | bash</div>
        <div className="install-alt"><div className="install-or">or via package manager:</div><div className="install-alt-row"><PkgSwitcher /><Cmd action="install" pkg="@glrs-dev/glrs@next" /></div></div>
      </div>
      <hr />
      <div className="doc-map">{links.map(([label, to]) => <Link key={to} to={to}><strong>{label}</strong><span>Browse documentation →</span></Link>)}</div>
    </main>
  );
}
