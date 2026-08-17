import { NavLink, Outlet, useLocation, Link } from "react-router";
import { Search } from "./Search";

export const SECTIONS = [
  { to: "/get-started", label: "get started", pages: [["Install", "/install"], ["Quickstart", "/quickstart"]] },
  { to: "/concepts", label: "concepts", pages: [["Philosophy", "/philosophy"], ["Glossary", "/glossary"], ["Architecture", "/architecture"]] },
  { to: "/extend", label: "extend", pages: [["Extensions", "/extensions"], ["Skills", "/skills"], ["Commands", "/commands"], ["Sequences", "/sequences"]] },
  { to: "/reference", label: "reference", pages: [["Tools", "/tools"], ["Providers", "/providers"], ["Models", "/models"], ["Configuration", "/configuration"], ["CLI", "/cli"], ["Extension API", "/api"]] },
  { to: "/help", label: "help", pages: [["Troubleshooting", "/troubleshooting"], ["Changelog", "/changelog"]] },
] as const;

const isCurrentSection = (pathname: string, to: string, pages: readonly (readonly [string, string])[]) => pathname === to || pages.some(([, page]) => pathname === page);

function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="side-nav">
      {SECTIONS.map((section) => (
        <section className="side-group" key={section.to}>
          <Link className={isCurrentSection(pathname, section.to, section.pages) ? "side-title active" : "side-title"} to={section.to}>{section.label}</Link>
          <nav>{section.pages.map(([label, to]) => <NavLink key={to} to={to}>{label}</NavLink>)}</nav>
        </section>
      ))}
    </aside>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return <nav className="breadcrumbs"><Link to="/">glrs</Link>{segments.map((segment, index) => <span key={segment}> / <Link to={`/${segments.slice(0, index + 1).join("/")}`}>{segment.replaceAll("-", " ")}</Link></span>)}</nav>;
}

export function Layout() {
  return (
    <>
      <header className="site-header">
        <NavLink to="/" className="logo">glrs</NavLink>
        <Search />
      </header>
      <Breadcrumbs />
      <div className="page-shell">
        <Sidebar />
        <div className="page-content"><Outlet /></div>
      </div>
      <footer className="site-footer"><span className="footer-mark">glorious</span><span className="footer-separator">·</span><span>next</span></footer>
    </>
  );
}
