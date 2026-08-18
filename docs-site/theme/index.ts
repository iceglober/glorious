import { Application, DefaultTheme } from "typedoc";

/** glrs.dev uses TypeDoc's proven document structure with our visual system. */
class GlrsTheme extends DefaultTheme {}

export function load(application: Application): void {
  application.renderer.defineTheme("glrs", GlrsTheme);
}
