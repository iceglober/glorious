import { afterEach, describe, expect, test } from "bun:test";
import {
  chromeBinary,
  clearWebCache,
  extractorAvailable,
  fetchPage,
  fetchPages,
  MAX_PAGES,
} from "./web-fetch";

const serve = (
  handler: (request: Request) => Response | Promise<Response>,
): { url: (path?: string) => string; stop: () => void; hits: () => number } => {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      hits += 1;
      return handler(request);
    },
  });
  return {
    url: (path = "/") => `http://127.0.0.1:${server.port}${path}`,
    stop: () => server.stop(true),
    hits: () => hits,
  };
};

const filler = "The quick brown fox jumps over the lazy dog. ".repeat(12);

const page = (body: string) =>
  new Response(
    `<!doctype html><html><head><title>t</title><style>.x{}</style></head><body><nav>skip me</nav><article>${body}<p>${filler}</p></article></body></html>`,
    { headers: { "content-type": "text/html" } },
  );

afterEach(() => {
  clearWebCache();
});

describe("input handling", () => {
  test("rejects a value that is not a URL", async () => {
    expect(await fetchPage("not a url", undefined)).toStartWith("ERROR: not a URL");
  });

  test("rejects a non-http scheme rather than shelling out", async () => {
    expect(await fetchPage("file:///etc/passwd", undefined)).toBe(
      "ERROR: unsupported scheme: file:",
    );
  });

  test("caps the batch at ten pages", () => {
    expect(MAX_PAGES).toBe(10);
  });
});

describe("extraction", () => {
  test("returns the article text without its markup", async () => {
    const site = serve(() => page("<p>The quick brown fox jumps.</p>"));
    try {
      const out = await fetchPage(site.url(), undefined);
      expect(out).toContain("The quick brown fox jumps.");
      expect(out).not.toContain("<p>");
    } finally {
      site.stop();
    }
  });

  // Dropping navigation needs trafilatura; the tag-strip fallback keeps it.
  test.if(extractorAvailable())("drops the boilerplate around the article", async () => {
    const site = serve(() => page("<p>The quick brown fox jumps.</p>"));
    try {
      expect(await fetchPage(site.url(), undefined)).not.toContain("skip me");
    } finally {
      site.stop();
    }
  });

  test("reports an HTTP failure as an ERROR string, never a throw", async () => {
    const site = serve(() => new Response("nope", { status: 500 }));
    try {
      expect(await fetchPage(site.url(), undefined)).toStartWith("ERROR:");
    } finally {
      site.stop();
    }
  });
});

describe("cross-host redirects", () => {
  test("are reported instead of followed", async () => {
    const site = serve(
      () => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/x" } }),
    );
    try {
      const out = await fetchPage(site.url(), undefined);
      expect(out).toStartWith("ERROR:");
      expect(out).toContain("elsewhere.test");
    } finally {
      site.stop();
    }
  });

  test("a same-host redirect is followed normally", async () => {
    const site = serve((request) =>
      new URL(request.url).pathname === "/from"
        ? new Response(null, { status: 302, headers: { location: "/to" } })
        : page("<p>Landed on the target.</p>"),
    );
    try {
      expect(await fetchPage(site.url("/from"), undefined)).toContain("Landed on the target.");
    } finally {
      site.stop();
    }
  });
});

describe("caching", () => {
  test("a second fetch of the same URL does not hit the network", async () => {
    const site = serve(() => page("<p>Cached body text here.</p>"));
    try {
      const first = await fetchPage(site.url(), undefined);
      const before = site.hits();
      const second = await fetchPage(site.url(), undefined);
      expect(second).toBe(first);
      expect(site.hits()).toBe(before);
    } finally {
      site.stop();
    }
  });

  test("clearing the cache makes it fetch again", async () => {
    const site = serve(() => page("<p>Body that will be refetched.</p>"));
    try {
      await fetchPage(site.url(), undefined);
      const before = site.hits();
      clearWebCache();
      await fetchPage(site.url(), undefined);
      expect(site.hits()).toBeGreaterThan(before);
    } finally {
      site.stop();
    }
  });
});

describe("batch", () => {
  test("a single URL returns bare content with no header", async () => {
    const site = serve(() => page("<p>Only one page fetched.</p>"));
    try {
      expect(await fetchPages([site.url()], undefined)).not.toContain("##");
    } finally {
      site.stop();
    }
  });

  test("several URLs come back labelled and in the order asked", async () => {
    const site = serve((request) => page(`<p>Body for ${new URL(request.url).pathname} here.</p>`));
    try {
      const out = await fetchPages([site.url("/one"), site.url("/two")], undefined);
      expect(out.indexOf("/one")).toBeLessThan(out.indexOf("/two"));
      expect(out).toContain("## ");
    } finally {
      site.stop();
    }
  });

  test("one bad URL does not sink the rest of the batch", async () => {
    const site = serve(() => page("<p>This one works fine.</p>"));
    try {
      const out = await fetchPages(["nonsense", site.url()], undefined);
      expect(out).toContain("ERROR: not a URL");
      expect(out).toContain("This one works fine.");
    } finally {
      site.stop();
    }
  });
});

// The whole reason for rendering rather than fetching: this page has no content
// until its script runs. Skipped when no browser is installed, where the tool
// correctly falls back to a plain fetch and cannot see it either.
describe.if(chromeBinary() !== null)("javascript-rendered pages", () => {
  test("content injected by a script is extracted", async () => {
    const site = serve(
      () =>
        new Response(
          `<!doctype html><html><body><article id="a"></article><script>
             document.getElementById("a").innerHTML =
               "<p>" + "Rendered only after the script ran. ".repeat(12) + "</p>";
           </script></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    );
    try {
      expect(await fetchPage(site.url(), undefined)).toContain(
        "Rendered only after the script ran.",
      );
    } finally {
      site.stop();
    }
  });
});
