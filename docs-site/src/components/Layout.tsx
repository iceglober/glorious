import { NavLink, Outlet, useLocation, Link } from "react-router";
import { Search } from "./Search";

export const SECTIONS = [
  { to: "/get-started", label: "get started", pages: [["Install", "/install"], ["Quickstart", "/quickstart"]] },
  { to: "/concepts", label: "concepts", pages: [["Philosophy", "/philosophy"], ["Glossary", "/glossary"], ["Architecture", "/architecture"]] },
  { to: "/extend", label: "extend", pages: [["Extensions", "/extensions"], ["Skills", "/skills"], ["Commands", "/commands"], ["Sequences", "/sequences"]] },
  { to: "/reference", label: "reference", pages: [["Tools", "/tools"], ["Providers", "/providers"], ["Models", "/models"], ["Configuration", "/configuration"], ["CLI", "/cli"], ["Extension API", "/api"]] },
  { to: "/help", label: "help", pages: [["Troubleshooting", "/troubleshooting"], ["Changelog", "/changelog"]] },
] as const;

const sectionFor = (pathname: string) => SECTIONS.find((section) => pathname.startsWith(section.to) || section.pages.some(([, to]) => pathname === to));

function Sidebar() {
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  if (!section) return null;
  return (
    <aside className="side-nav">
      <Link className="side-title" to={section.to}>{section.label}</Link>
      <nav>
        {section.pages.map(([label, to]) => <NavLink key={to} to={to}>{label}</NavLink>)}
      </nav>
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
  const { pathname } = useLocation();
  const hasSidebar = pathname !== "/";
  return (
    <>
      <header className="site-header">
        <NavLink to="/" className="logo">glrs</NavLink>
        <nav className="top-nav">{SECTIONS.map(({ to, label }) => <NavLink key={to} to={to} className={({ isActive }) => isActive || pathname.startsWith(to) ? "active" : ""}>{label}</NavLink>)}</nav>
        <Search />
      </header>
      <Breadcrumbs />
      <div className={hasSidebar ? "page-shell" : "page-shell home-shell"}>
        <Sidebar />
        <div className="page-content"><Outlet /></div>
      </div>
      <footer className="site-footer"><span className="footer-mark">glorious</span><span className="footer-separator">·</span><span>next</span></footer>
    </>
  );
}
