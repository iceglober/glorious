import { NavLink, Outlet, useLocation, Link } from "react-router";
import { SECTIONS } from "~/navigation";
import { EditableText } from "./EditMode";
import { Search } from "./Search";

const isCurrentSection = (pathname: string, to: string, pages: readonly { to: string }[]) =>
  pathname === to || pages.some((page) => pathname === page.to);

function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="side-nav">
      {SECTIONS.map((section) => (
        <section className="side-group" key={section.to}>
          <Link className={isCurrentSection(pathname, section.to, section.pages) ? "side-title active" : "side-title"} to={section.to}>
            <EditableText path={`sections.${section.key}.label`} />
          </Link>
          <nav>
            {section.pages.map((page) => (
              <NavLink key={page.to} to={page.to}>
                <EditableText path={`pages.${page.key}`} />
              </NavLink>
            ))}
          </nav>
        </section>
      ))}
    </aside>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <nav className="breadcrumbs">
      <Link to="/">
        <EditableText path="brand.short" />
      </Link>
      {segments.map((segment, index) => (
        <span key={segment}>
          {" / "}
          <Link to={`/${segments.slice(0, index + 1).join("/")}`}>{segment.replaceAll("-", " ")}</Link>
        </span>
      ))}
    </nav>
  );
}

export function Layout() {
  return (
    <>
      <header className="site-header">
        <NavLink to="/" className="logo">
          <EditableText path="brand.short" />
        </NavLink>
        <Search />
      </header>
      <Breadcrumbs />
      <div className="page-shell">
        <Sidebar />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
      <footer className="site-footer">
        <span className="footer-mark">
          <EditableText path="brand.name" />
        </span>
        <span className="footer-separator">·</span>
        <span>
          <EditableText path="brand.channel" />
        </span>
      </footer>
    </>
  );
}
