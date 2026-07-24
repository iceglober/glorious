import { describe, expect, test } from "bun:test";
import { tuiConfigSchema } from "./config";

describe("tuiConfigSchema", () => {
  test("parses to an empty object and fills a missing tui block", () => {
    expect(tuiConfigSchema.parse({})).toEqual({});
    expect(tuiConfigSchema.parse(undefined)).toEqual({});
  });
  test("ignores a legacy renderer key rather than rejecting it", () => {
    // Old configs may still carry `tui.renderer: ansi`; it's stripped, not an error.
    const parsed = tuiConfigSchema.safeParse({ renderer: "ansi" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({});
  });
});
