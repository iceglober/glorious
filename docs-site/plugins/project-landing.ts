import {
  Application,
  PageKind,
  ParameterType,
  type ProjectReflection,
  type Reflection,
  StructureDirRouter,
} from "typedoc";

export const PROJECT_LANDING_OPTION = "projectLanding";

export type ProjectLanding = { path: string; label: string };

export const projectLanding = (value: unknown): ProjectLanding => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${PROJECT_LANDING_OPTION} must be an object`);
  const raw = value as Record<string, unknown>;
  const path = typeof raw.path === "string" ? raw.path.replace(/^\/+|\/+$/gu, "") : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (path === "" || path.split("/").includes(".."))
    throw new Error(`${PROJECT_LANDING_OPTION}.path must be a non-empty relative URL path`);
  if (label === "") throw new Error(`${PROJECT_LANDING_OPTION}.label must be a non-empty string`);
  return { path, label };
};

class ProjectLandingRouter extends StructureDirRouter {
  private landing(): ProjectLanding {
    return projectLanding(this.application.options.getValue(PROJECT_LANDING_OPTION));
  }

  protected override getIdealBaseName(reflection: Reflection): string {
    return `${this.landing().path}/${super.getIdealBaseName(reflection)}`;
  }

  override buildPages(project: ProjectReflection) {
    const { path } = this.landing();
    const pages = super.buildPages(project).map((page) => {
      if (page.model === project && page.kind === PageKind.Reflection)
        return { ...page, url: `${path}/index.html` };
      if (page.kind === PageKind.Hierarchy)
        return { ...page, url: `${path}/hierarchy/index.html` };
      return page;
    });
    this.fullUrls.set(project, `${path}/index.html`);
    return pages;
  }
}

export function load(application: Application): void {
  application.options.addDeclaration({
    name: PROJECT_LANDING_OPTION,
    help: "Configure the root landing-page link and URL prefix for this documentation project.",
    type: ParameterType.Mixed,
    defaultValue: { path: "project", label: "project" },
  });
  application.renderer.defineRouter("project-landing", ProjectLandingRouter);
}
