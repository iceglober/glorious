import { useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router";
import { useEditMode } from "./EditMode";
import { Search } from "./Search";

const isCurrentSection = (
  pathname: string,
  key: string,
  pages: readonly { slug: string }[],
) => pathname === `/${key}` || pages.some((page) => pathname === `/${page.slug}`);

function SiteSettings() {
  const { content, change } = useEditMode();
  return (
    <div className="site-settings">
      <label>
        Site name
        <input
          defaultValue={content.brand.name}
          onBlur={(event) => change("brand.name", event.currentTarget.value)}
        />
      </label>
      <label>
        Short name
        <input
          defaultValue={content.brand.short}
          onBlur={(event) => change("brand.short", event.currentTarget.value)}
        />
      </label>
      <label>
        Tagline
        <input
          defaultValue={content.brand.tagline}
          onBlur={(event) => change("brand.tagline", event.currentTarget.value)}
        />
      </label>
      <label>
        Release channel
        <input
          defaultValue={content.brand.channel}
          onBlur={(event) => change("brand.channel", event.currentTarget.value)}
        />
      </label>
      <label>
        Search placeholder
        <input
          defaultValue={content.search.placeholder}
          onBlur={(event) => change("search.placeholder", event.currentTarget.value)}
        />
      </label>
      <label>
        Package-manager prompt
        <input
          defaultValue={content.home.packageAlternative}
          onBlur={(event) => change("home.packageAlternative", event.currentTarget.value)}
        />
      </label>
      <fieldset>
        <legend>Install page</legend>
        {Object.entries(content.install).map(([key, value]) => (
          <label key={key}>
            {key}
            <input
              defaultValue={value}
              onBlur={(event) => change(`install.${key}`, event.currentTarget.value)}
            />
          </label>
        ))}
      </fieldset>
      {content.navigation.map((section, sectionIndex) => (
        <fieldset key={section.key}>
          <legend>{section.label}</legend>
          <label>
            Section label
            <input
              defaultValue={section.label}
              onBlur={(event) =>
                change(`navigation.${sectionIndex}.label`, event.currentTarget.value)
              }
            />
          </label>
          <label>
            Introduction
            <textarea
              defaultValue={section.intro}
              onBlur={(event) =>
                change(`navigation.${sectionIndex}.intro`, event.currentTarget.value)
              }
            />
          </label>
          {section.pages.map((page, pageIndex) => (
            <label key={page.slug}>
              /{page.slug}
              <input
                defaultValue={page.label}
                onBlur={(event) =>
                  change(
                    `navigation.${sectionIndex}.pages.${pageIndex}.label`,
                    event.currentTarget.value,
                  )
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function Sidebar() {
  const { pathname } = useLocation();
  const { content, editing, addPage, addSection } = useEditMode();
  const [settings, setSettings] = useState(false);
  return (
    <aside className="side-nav">
      {editing && (
        <button
          className="editor-action settings-action"
          type="button"
          onClick={() => setSettings((open) => !open)}
        >
          <span>⚙</span>
          <strong>Site Settings</strong>
        </button>
      )}
      {settings && <SiteSettings />}
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
            {section.label}
          </Link>
          <nav>
            {section.pages.map((page) => (
              <NavLink key={page.slug} to={`/${page.slug}`}>
                {page.label}
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
  const { content } = useEditMode();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <nav className="breadcrumbs">
      <Link to="/">{content.brand.short}</Link>
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
  const { content } = useEditMode();
  return (
    <>
      <header className="site-header">
        <NavLink to="/" className="logo">
          {content.brand.short}
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
        <span className="footer-mark">{content.brand.name}</span>
        <span className="footer-separator">·</span>
        <span>{content.brand.channel}</span>
      </footer>
    </>
  );
}
