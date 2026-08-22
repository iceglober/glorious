import { describe, expect, test } from "bun:test";
import { fetchStars, formatStars, repoFromUrl } from "./stars";

describe("toolbar star count", () => {
  test("reads the repository out of the toolbar's own github link", () => {
    expect(repoFromUrl("https://github.com/iceglober/glorious")).toBe("iceglober/glorious");
    expect(repoFromUrl("https://github.com/iceglober/glrs/")).toBe("iceglober/glrs");
    expect(repoFromUrl("https://github.com/iceglober/glrs.git")).toBe("iceglober/glrs");
    // The link may point deeper than the repository root.
    expect(repoFromUrl("https://github.com/iceglober/glrs/actions/workflows/ci.yml")).toBe(
      "iceglober/glrs",
    );
  });

  test("returns null for anything that is not a repository", () => {
    for (const url of [
      "https://www.npmjs.com/package/@glrs-dev/glrs",
      "https://github.com/iceglober",
      "https://github.com",
      "not a url",
      "",
    ])
      expect(repoFromUrl(url)).toBeNull();
  });

  test("rounds the way GitHub does", () => {
    expect(formatStars(0)).toBe("0");
    expect(formatStars(999)).toBe("999");
    expect(formatStars(1000)).toBe("1k");
    expect(formatStars(1234)).toBe("1.2k");
    expect(formatStars(12_345)).toBe("12.3k");
    expect(formatStars(123_456)).toBe("123k");
  });

  test("returns the count", async () => {
    const ok = new Response(JSON.stringify({ stargazers_count: 1234 }), { status: 200 });
    expect(await fetchStars("o/r", async () => ok)).toBe(1234);
  });

  test("returns null rather than throwing, so a build never fails on it", async () => {
    const rateLimited = new Response("{}", { status: 403 });
    expect(await fetchStars("o/r", async () => rateLimited)).toBeNull();

    const offline = async (): Promise<Response> => {
      throw new Error("network unreachable");
    };
    expect(await fetchStars("o/r", offline)).toBeNull();

    const nonsense = new Response(JSON.stringify({ stargazers_count: "many" }), { status: 200 });
    expect(await fetchStars("o/r", async () => nonsense)).toBeNull();

    const notJson = new Response("<html>", { status: 200 });
    expect(await fetchStars("o/r", async () => notJson)).toBeNull();
  });

  test("sends the token when one is present", async () => {
    const seen: string[] = [];
    const capture = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      seen.push(String((init?.headers as Record<string, string>)?.authorization));
      return new Response(JSON.stringify({ stargazers_count: 1 }), { status: 200 });
    };
    const original = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "t0ken";
    await fetchStars("o/r", capture as typeof fetch);
    delete process.env.GITHUB_TOKEN;
    await fetchStars("o/r", capture as typeof fetch);
    if (original !== undefined) process.env.GITHUB_TOKEN = original;
    expect(seen).toEqual(["Bearer t0ken", "undefined"]);
  });
});
