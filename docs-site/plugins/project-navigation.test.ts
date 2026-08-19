import { describe, expect, test } from "bun:test";
import { documentationProjects } from "./project-navigation.ts";

describe("project navigation configuration", () => {
  test("reads labels, roots, and entry points", () => {
    expect(
      documentationProjects([
        { label: " coding agent ", root: "/repo/docs/agent", entryPoints: ["/repo/a.ts"] },
      ]),
    ).toEqual([
      { label: "coding agent", root: "/repo/docs/agent", entryPoints: ["/repo/a.ts"] },
    ]);
  });

  test("requires a label and root", () => {
    expect(() => documentationProjects([{ root: "/repo" }])).toThrow("label");
    expect(() => documentationProjects([{ label: "agent" }])).toThrow("root");
  });
});
