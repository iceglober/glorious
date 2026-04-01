import { describe, test, expect } from "bun:test";
import { slugify } from "./slug.js";

describe("slugify", () => {
  test("preserves dots in version strings", () => {
    expect(slugify("v1.0.0")).toBe("v1.0.0");
    expect(slugify("release v1.0.0")).toBe("release-v1.0.0");
    expect(slugify("fix bug in v1.0.0")).toBe("fix-bug-in-v1.0.0");
  });

  test("collapses consecutive dots", () => {
    expect(slugify("v1..0..0")).toBe("v1.0.0");
  });

  test("strips leading and trailing dots and hyphens", () => {
    expect(slugify("...leading")).toBe("leading");
    expect(slugify("trailing...")).toBe("trailing");
    expect(slugify("-leading-")).toBe("leading");
  });

  test("basic kebab-case conversion", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("foo  bar  baz")).toBe("foo-bar-baz");
  });

  test("truncates long slugs on word boundary", () => {
    const long = "this is a very long title that should be truncated on a word boundary";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).not.toEndWith("-");
  });

  test("preserves dots in version strings after truncation", () => {
    const result = slugify("t1-fix version v1.0.0 dots");
    expect(result).toBe("t1-fix-version-v1.0.0-dots");
  });
});
