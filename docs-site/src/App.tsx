import { BrowserRouter, Route, Routes } from "react-router";
import { EditModeProvider, useEditMode, type NavigationPage } from "./components/EditMode";
import { Layout } from "./components/Layout";
import { PkgManagerProvider } from "./components/PkgManager";
import { Changelog } from "./pages/Changelog";
import { Doc } from "./pages/Doc";
import { Home } from "./pages/Home";
import { Install } from "./pages/Install";
import { SectionPage } from "./pages/SectionPage";
import apiMd from "./generated/extension-api.md?raw";
import homeMdx from "./content/home.mdx?raw";
import installMdx from "./content/install.mdx?raw";

const documents = import.meta.glob("../../docs/published/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const markdown = (slug: string): string =>
  documents[`../../docs/published/${slug}.md`] ?? `# Missing page\n\nNo Markdown file exists for \`${slug}\`.`;

const pageElement = (page: NavigationPage, editing: boolean) => {
  if (page.kind === "install") return <Install source={installMdx} />;
  if (page.kind === "changelog") return <Changelog />;
  if (page.kind === "generated") return <Doc md={apiMd} title={page.label} />;
  const source = markdown(page.slug);
  const rendered = editing
    ? source
    : source
        .replaceAll("{{generated:extension-api}}", apiMd)
        .replace(/\{\{asset:([^}]+)\}\}/gu, (_directive, path: string) =>
          /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(path)
            ? `![${path}](${path})`
            : `[${path}](${path})`,
        );
  return (
    <Doc
      md={rendered}
      title={page.label}
      source={`docs/published/${page.slug}.md`}
    />
  );
};

function SiteRoutes() {
  const { content, editing } = useEditMode();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home source={homeMdx} />} />
        {content.navigation.map((section) => (
          <Route
            key={section.key}
            path={section.key}
            element={<SectionPage sectionKey={section.key} />}
          />
        ))}
        {content.navigation.flatMap((section) =>
          section.pages.map((page) => (
            <Route
              key={page.slug}
              path={page.slug}
              element={pageElement(page, editing)}
            />
          )),
        )}
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <PkgManagerProvider>
      <EditModeProvider>
        <BrowserRouter>
          <SiteRoutes />
        </BrowserRouter>
      </EditModeProvider>
    </PkgManagerProvider>
  );
}
