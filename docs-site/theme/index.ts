import {
  Application,
  ContainerReflection,
  DefaultTheme,
  DefaultThemeRenderContext,
  DocumentReflection,
  JSX,
  type NavigationElement,
  type ProjectReflection,
} from "typedoc";
import { documentFolderNames } from "../plugins/group-documents.ts";
import {
  DOCUMENTATION_PROJECTS_OPTION,
  documentationProjects,
  navigationOwner,
} from "../plugins/project-navigation.ts";

class GlrsRenderContext extends DefaultThemeRenderContext {
  constructor(...args: ConstructorParameters<typeof DefaultThemeRenderContext>) {
    super(...args);
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
    const removeFolderLinks = (items: NavigationElement[]): NavigationElement[] =>
      items.map((item) => ({
        ...item,
        ...(item.children && documentFolderNames.has(item.text) ? { path: undefined } : {}),
        children: item.children ? removeFolderLinks(item.children) : undefined,
      }));
    const navigation = removeFolderLinks(super.buildNavigation(project));
    const ownerByPath = new Map<string, string>();
    const visit = (reflection: ContainerReflection | DocumentReflection): void => {
      const children =
        reflection instanceof DocumentReflection
          ? (reflection.children ?? [])
          : (reflection.childrenIncludingDocuments ?? []);
      for (const child of children) {
        const owner = navigationOwner(child);
        if (owner !== undefined && this.router.hasUrl(child))
          ownerByPath.set(this.router.getFullUrl(child), owner);
        if (child instanceof ContainerReflection || child instanceof DocumentReflection) visit(child);
      }
    };
    visit(project);

    const ownerOf = (item: NavigationElement): string | undefined => {
      if (item.path !== undefined && ownerByPath.has(item.path)) return ownerByPath.get(item.path);
      const childOwners = new Set(
        (item.children ?? []).map(ownerOf).filter((one): one is string => one !== undefined),
      );
      return childOwners.size === 1 ? [...childOwners][0] : undefined;
    };
    const configured = documentationProjects(
      this.application.options.getValue(DOCUMENTATION_PROJECTS_OPTION),
    );
    const used = new Set<NavigationElement>();
    const groups = configured.flatMap((configuredProject): NavigationElement[] => {
      const children = navigation.filter((item) => ownerOf(item) === configuredProject.label);
      for (const item of children) used.add(item);
      return children.length === 0 ? [] : [{ text: configuredProject.label, children }];
    });
    return [...groups, ...navigation.filter((item) => !used.has(item))];
  }
}

export function load(application: Application): void {
  application.renderer.defineTheme("glrs", GlrsTheme);
}
