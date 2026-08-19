import { describe, expect, test } from "bun:test";
import {
  compareDocumentPaths,
  directoryLabel,
  documentDirectories,
  documentPath,
} from "./group-documents-utils.ts";

describe("external document directory grouping", () => {
  test("orders directory groups with top-level documents by path", () => {
    expect(["skills.md", "DIR/", "architecture.md"].sort(compareDocumentPaths)).toEqual([
      "architecture.md",
      "DIR/",
      "skills.md",
    ]);
  });

  test("keeps the relative path used for ordering", () => {
    expect(documentPath("/repo/docs/guides/setup.md", ["/repo/docs/**/*.md"])).toBe(
      "guides/setup.md",
    );
  });

  test("returns nested directories beneath a glob root", () => {
    expect(documentDirectories("/repo/docs/guides/setup/install.md", ["/repo/docs/**/*.md"])).toEqual([
      "guides",
      "setup",
    ]);
  });

  test("leaves root documents ungrouped", () => {
    expect(documentDirectories("/repo/docs/quickstart.md", ["/repo/docs/**/*.md"])).toBeNull();
  });

  test("does nothing without a glob", () => {
    expect(documentDirectories("/repo/docs/guides/setup.md", ["/repo/docs/setup.md"])).toBeNull();
  });

  test("can lowercase humanized directory titles", () => {
    expect(directoryLabel("API-guides")).toBe("API Guides");
    expect(directoryLabel("API-guides", true)).toBe("api guides");
  });
});
