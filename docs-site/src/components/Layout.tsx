import { NavLink, Outlet, useLocation, Link } from "react-router";
import { EditableText, useEditMode } from "./EditMode";
import { Search } from "./Search";

const isCurrentSection = (
  pathname: string,
  key: string,
  pages: readonly { slug: string }[],
) => pathname === `/${key}` || pages.some((page) => pathname === `/${page.slug}`);

function Sidebar() {
  const { pathname } = useLocation();
  const { content, editing, addPage, addSection } = useEditMode();
  return (
    <aside className="side-nav">
      {content.navigation.map((section, sectionIndex) => (
        <section className="side-group" key={section.key}>
          <Link
            className={
              isCurrentSection(pathname, section.key, section.pages)
                ? "side-title active"
                : "side-title"
            }
            to={`/${section.key}`}
          >
            <EditableText path={`navigation.${sectionIndex}.label`} />
          </Link>
          <nav>
            {section.pages.map((page, pageIndex) => (
              <NavLink key={page.slug} to={`/${page.slug}`}>
                <EditableText path={`navigation.${sectionIndex}.pages.${pageIndex}.label`} />
              </NavLink>
            ))}
          </nav>
          {editing && (
            <button className="editor-action" type="button" onClick={() => addPage(sectionIndex)}>
              <span>+</span>
              <strong>Add Page</strong>
            </button>
          )}
        </section>
      ))}
      {editing && (
        <button className="editor-action add-section" type="button" onClick={addSection}>
          <span>+</span>
          <strong>Add Section</strong>
        </button>
      )}
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
          <Link to={`/${segments.slice(0, index + 1).join("/")}`}>
            {segment.replaceAll("-", " ")}
          </Link>
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
