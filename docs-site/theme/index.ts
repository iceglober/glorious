import { readFileSync } from "node:fs";
import {
  Application,
  DefaultTheme,
  DefaultThemeRenderContext,
  DocumentReflection,
  JSX,
  type NavigationElement,
  type ProjectReflection,
} from "typedoc";
import { documentFolderNames } from "../plugins/group-documents.ts";
import { formatStars, MINIMUM_STARS } from "../scripts/stars.ts";

class GlrsRenderContext extends DefaultThemeRenderContext {
  constructor(...args: ConstructorParameters<typeof DefaultThemeRenderContext>) {
    super(...args);
    const pageSidebar = this.pageSidebar;
    this.pageSidebar = (props) =>
      props.url === "index.html" ? JSX.createElement(JSX.Fragment, null) : pageSidebar(props);
    this.indexTemplate = (props) =>
      JSX.createElement(
        JSX.Fragment,
        null,
        JSX.createElement(
          "div",
          { class: "tsd-panel tsd-typography" },
          JSX.createElement(JSX.Raw, { html: this.markdown(props.model.readme ?? []) }),
        ),
        this.moduleReflection(props.model),
      );
    const moduleMemberSummary = this.moduleMemberSummary;
    this.moduleMemberSummary = (member) => {
      const isFolder =
        member instanceof DocumentReflection &&
        member.children !== undefined &&
        documentFolderNames.has(member.name);
      if (!isFolder) return moduleMemberSummary(member);
      const classes = `tsd-member-summary ${this.getReflectionClasses(member)}`;
      return JSX.createElement(
        JSX.Fragment,
        null,
        JSX.createElement(
          "dt",
          { class: classes },
          JSX.createElement(
            "span",
            { class: "tsd-member-summary-name" },
            this.reflectionIcon(member),
            JSX.createElement("span", null, member.name),
          ),
        ),
        JSX.createElement("dd", { class: classes }, this.commentShortSummary(member)),
      );
    };
  }
}

/** glrs.dev uses TypeDoc's proven document structure with our visual system. */
class GlrsTheme extends DefaultTheme {
  override ContextClass = GlrsRenderContext;
  override buildNavigation(project: ProjectReflection): NavigationElement[] {
    const navigation = super.buildNavigation(project);
    const removeFolderLinks = (items: NavigationElement[]): NavigationElement[] =>
      items.map((item) => ({
        ...item,
        ...(item.children && documentFolderNames.has(item.text) ? { path: undefined } : {}),
        children: item.children ? removeFolderLinks(item.children) : undefined,
      }));
    return removeFolderLinks(navigation);
  }
}

/**
 * Add the star count to the toolbar, as one more navigation link. TypeDoc
 * renders a link's key as its text, so this needs no template override, and
 * the badge points at the stargazers list rather than the repository.
 *
 * The count comes from generated/stars.json, which build.ts writes. Anything
 * missing, unreadable, or below MINIMUM_STARS renders no badge, which is why
 * running TypeDoc directly is still fine.
 */
const addStarsLink = (application: Application): void => {
  let read: { repo?: unknown; stars?: unknown };
  try {
    read = JSON.parse(
      // import.meta.dir is a Bun extension and is undefined under TypeDoc's
      // loader, so resolve against the module URL instead.
      readFileSync(new URL("../generated/stars.json", import.meta.url), "utf8"),
    ) as typeof read;
  } catch {
    return;
  }
  const { repo, stars } = read;
  if (typeof repo !== "string" || typeof stars !== "number") return;
  if (stars < MINIMUM_STARS) return;
  const links = application.options.getValue("navigationLinks") as Record<string, string>;
  application.options.setValue("navigationLinks", {
    ...links,
    [`★ ${formatStars(stars)}`]: `https://github.com/${repo}/stargazers`,
  });
};

export function load(application: Application): void {
  application.renderer.defineTheme("glrs", GlrsTheme);
  // Not during load: TypeDoc reads typedoc.json after plugins load, so
  // navigationLinks set here is overwritten by the file's own value.
  application.on(Application.EVENT_BOOTSTRAP_END, () => addStarsLink(application));
}
