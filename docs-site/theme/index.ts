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

class GlrsRenderContext extends DefaultThemeRenderContext {
  constructor(...args: ConstructorParameters<typeof DefaultThemeRenderContext>) {
    super(...args);
    const pageNavigation = this.pageNavigation;
    this.pageNavigation = (props) =>
      props.model.isProject() ? JSX.createElement(JSX.Fragment, null) : pageNavigation(props);
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

export function load(application: Application): void {
  application.renderer.defineTheme("glrs", GlrsTheme);
}
