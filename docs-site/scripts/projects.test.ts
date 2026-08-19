import { describe, expect, test } from "bun:test";
import { projectFromIndex } from "./projects.ts";

describe("documentation project indexes", () => {
  test("the parent directory is the route and frontmatter supplies the label", () => {
    const project = projectFromIndex(
      "/repo/docs/published/coding-agent/index.md",
      [
        "---",
        "label: coding agent",
        "name: glrs",
        "entryPoints:",
        "  - ../../../packages/agent.ts",
        "---",
      ].join("\n"),
    );
    expect(project.path).toBe("coding-agent");
    expect(project.label).toBe("coding agent");
    expect(project.name).toBe("glrs");
    expect(project.entryPoints).toEqual(["/repo/packages/agent.ts"]);
    expect(project.projectDocuments[0]).toEndWith("coding-agent/**/!(index).md");
  });

  test("name defaults to the label and entry points are optional", () => {
    const project = projectFromIndex(
      "/repo/docs/published/notes/index.md",
      "---\nlabel: release notes\n---\n",
    );
    expect(project.name).toBe("release notes");
    expect(project.entryPoints).toEqual([]);
  });

  test("frontmatter and a label are required", () => {
    expect(() => projectFromIndex("/repo/docs/published/x/index.md", "# x")).toThrow(
      "needs frontmatter",
    );
    expect(() =>
      projectFromIndex("/repo/docs/published/x/index.md", "---\nname: x\n---\n"),
    ).toThrow("needs a label");
  });

  test("the parent directory must be URL safe", () => {
    expect(() =>
      projectFromIndex("/repo/docs/published/Not Safe/index.md", "---\nlabel: x\n---\n"),
    ).toThrow("URL-safe");
  });
});
