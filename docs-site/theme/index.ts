import { readFileSync } from "node:fs";
import {
  Application,
  Converter,
  DefaultTheme,
  DefaultThemeRenderContext,
  JSX,
  type NavigationElement,
  type ProjectReflection,
} from "typedoc";
import { documentFolderNames } from "../plugins/group-documents.ts";

const packageVersion = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

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
  application.converter.on(Converter.EVENT_RESOLVE_END, () => {
    const links = application.options.getValue("navigationLinks");
    application.options.setValue("navigationLinks", {
      ...links,
      [`v${packageVersion}`]: "https://www.npmjs.com/package/@glrs-dev/glrs",
    });
  });
  application.renderer.defineTheme("glrs", GlrsTheme);
}
