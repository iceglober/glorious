import {
  Application,
  DefaultTheme,
  type NavigationElement,
  type ProjectReflection,
} from "typedoc";
import { documentFolderNames } from "../plugins/group-documents.ts";

/** glrs.dev uses TypeDoc's proven document structure with our visual system. */
class GlrsTheme extends DefaultTheme {
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
