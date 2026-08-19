import {
  Application,
  DefaultTheme,
  DefaultThemeRenderContext,
  DocumentReflection,
  JSX,
  PageKind,
  type NavigationElement,
  type ProjectReflection,
  type Reflection,
  StructureDirRouter,
} from "typedoc";
import { documentFolderNames } from "../plugins/group-documents.ts";

class AgentRouter extends StructureDirRouter {
  protected override getIdealBaseName(reflection: Reflection): string {
    return `agent/${super.getIdealBaseName(reflection)}`;
  }

  override buildPages(project: ProjectReflection) {
    const pages = super.buildPages(project).map((page) => {
      if (page.model === project && page.kind === PageKind.Reflection)
        return { ...page, url: "agent/index.html" };
      if (page.kind === PageKind.Hierarchy) return { ...page, url: "agent/hierarchy/index.html" };
      return page;
    });
    this.fullUrls.set(project, "agent/index.html");
    return pages;
  }
}

class GlrsRenderContext extends DefaultThemeRenderContext {
  constructor(...args: ConstructorParameters<typeof DefaultThemeRenderContext>) {
    super(...args);
    const pageSidebar = this.pageSidebar;
    this.pageSidebar = (props) =>
      props.url === "index.html" ? JSX.createElement(JSX.Fragment, null) : pageSidebar(props);
    const sidebar = this.sidebar;
    this.sidebar = (props) =>
      props.url === "index.html" ? JSX.createElement(JSX.Fragment, null) : sidebar(props);
    this.indexTemplate = (props) =>
      JSX.createElement(
        "div",
        { class: "tsd-panel tsd-typography" },
        JSX.createElement(JSX.Raw, { html: this.markdown(props.model.readme ?? []) }),
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

export function load(application: Application): void {
  application.renderer.defineRouter("glrs-agent", AgentRouter);
  application.renderer.defineTheme("glrs", GlrsTheme);
}
