import type { Glorious } from "@glrs-dev/glorious-core";

// Bundled, enabled by default, and written the way any extension is: it reaches
// for nothing but Bun globals and the API object. That is the point — this is
// the largest tool glorious has, and if the extension API could not express it
// the API would be a toy.
//
// Delete it, shadow it with your own .glorious/extensions/web-fetch.ts, or
// leave it alone; none of that touches the core.

const CACHE_MS = 15 * 60_000;
const RENDER_MS = 25_000;
const EXTRACT_MS = 25_000;
const GRACE_MS = 3_000;
const AT_ONCE = 4;
export const MAX_PAGES = 10;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const cache = new Map<string, { at: number; text: string }>();

export const extractorAvailable = (): boolean => Bun.which("uvx") !== null;

export const chromeBinary = (): string | null => {
  for (const path of CHROME_PATHS) if (Bun.file(path).size > 0) return path;
  return Bun.which("google-chrome") ?? Bun.which("chromium") ?? null;
};

const signalGroup = (pid: number, name: NodeJS.Signals): void => {
  try {
    process.kill(-pid, name);
  } catch {}
};

// Bun.spawn with an stdin payload, a deadline, and process-group kill — the
// same contract as tools.ts's launch(), which has no stdin.
const pipe = async (
  argv: string[],
  input: string | null,
  deadline: number,
  caller: AbortSignal | undefined,
): Promise<{ out: string; failed: string }> => {
  if (caller?.aborted) return { out: "", failed: "[interrupted]" };
  // Bun.spawn throws when the binary is absent. Chrome and uvx are both
  // optional, so a missing one has to read as a failed step and let the caller
  // fall back rather than take the whole fetch down.
  const started = (() => {
    try {
      return Bun.spawn(argv, {
        stdin: input === null ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
    } catch (thrown) {
      return thrown instanceof Error ? thrown.message : String(thrown);
    }
  })();
  if (typeof started === "string") return { out: "", failed: started };
  const child = started;
  const clock = AbortSignal.timeout(deadline);
  const stopper = caller ? AbortSignal.any([caller, clock]) : clock;
  const settled = new AbortController();
  let failed = "";
  let escalation: ReturnType<typeof setTimeout> | undefined;
  stopper.addEventListener(
    "abort",
    () => {
      failed = caller?.aborted ? "[interrupted]" : `[timed out after ${deadline / 1000}s]`;
      signalGroup(child.pid, "SIGTERM");
      escalation ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), GRACE_MS).unref();
    },
    { once: true, signal: settled.signal },
  );
  const stdin = child.stdin;
  if (input !== null && stdin !== undefined) {
    try {
      stdin.write(input);
      await stdin.end();
    } catch {}
  }
  const out = await new Response(child.stdout).text().catch(() => "");
  const err = await new Response(child.stderr).text().catch(() => "");
  const code = await child.exited;
  settled.abort();
  clearTimeout(escalation);
  if (failed === "" && code !== 0 && out.trim() === "")
    failed = `exited ${code}${err.trim() === "" ? "" : `: ${err.trim().split("\n")[0]}`}`;
  return { out, failed };
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// One cheap request answers two questions: is this a cross-host redirect, which
// is surfaced rather than followed so a login wall or shortener cannot silently
// become the answer, and did the server actually serve the page. The status
// matters because Chrome renders a 404 or 500 body just as happily as a 200.
type Probe = { status: number; redirect: string | null };

const probe = async (url: string, caller: AbortSignal | undefined): Promise<Probe> => {
  const response = await fetch(url, {
    redirect: "manual",
    signal: caller,
    headers: { "user-agent": "glorious" },
  }).catch(() => null);
  if (!response) return { status: 0, redirect: null };
  if (response.status < 300 || response.status >= 400)
    return { status: response.status, redirect: null };
  const location = response.headers.get("location");
  if (!location) return { status: response.status, redirect: null };
  const target = new URL(location, url).toString();
  return {
    status: response.status,
    redirect: hostOf(target) === hostOf(url) ? null : target,
  };
};

const tags = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

const stripHtml = (html: string): string =>
  html
    .replace(tags, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const render = async (
  url: string,
  caller: AbortSignal | undefined,
): Promise<{ html: string; failed: string }> => {
  const chrome = chromeBinary();
  if (chrome !== null) {
    const { out, failed } = await pipe(
      [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--virtual-time-budget=5000",
        "--dump-dom",
        url,
      ],
      null,
      RENDER_MS,
      caller,
    );
    if (out.trim() !== "") return { html: out, failed: "" };
    if (caller?.aborted) return { html: "", failed };
  }
  const response = await fetch(url, { signal: caller, headers: { "user-agent": "glorious" } })
    .then((got) => (got.ok ? got.text() : Promise.reject(new Error(`HTTP ${got.status}`))))
    .catch((thrown: unknown) => (thrown instanceof Error ? thrown : new Error(String(thrown))));
  return response instanceof Error
    ? { html: "", failed: response.message }
    : { html: response, failed: "" };
};

const extract = async (html: string, caller: AbortSignal | undefined): Promise<string> => {
  const { out } = await pipe(["uvx", "trafilatura", "--markdown"], html, EXTRACT_MS, caller);
  return out.trim() === "" ? stripHtml(html) : out.trim();
};

export const fetchPage = async (url: string, caller: AbortSignal | undefined): Promise<string> => {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return `ERROR: not a URL: ${url}`;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:")
    return `ERROR: unsupported scheme: ${target.protocol}`;

  const fresh = cache.get(target.toString());
  if (fresh && Date.now() - fresh.at < CACHE_MS) return fresh.text;

  const seen = await probe(target.toString(), caller);
  if (seen.redirect !== null)
    return `ERROR: ${target.host} redirects to another host: ${seen.redirect}\nFetch that URL directly if it is the one you want.`;
  if (seen.status >= 400) return `ERROR: HTTP ${seen.status}`;

  const { html, failed } = await render(target.toString(), caller);
  if (failed !== "") return `ERROR: ${failed}`;
  if (html.trim() === "") return "ERROR: empty response";

  const text = await extract(html, caller);
  if (text === "") return "ERROR: nothing extractable on the page";
  cache.set(target.toString(), { at: Date.now(), text });
  return text;
};

export const fetchPages = async (
  urls: readonly string[],
  caller: AbortSignal | undefined,
): Promise<string> => {
  const results: string[] = new Array(urls.length).fill("");
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const at = next;
      next += 1;
      results[at] = await fetchPage(urls[at], caller).catch(
        (thrown: unknown) => `ERROR: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, urls.length) }, worker));
  if (urls.length === 1) return results[0];
  return urls.map((url, at) => `## ${url}\n\n${results[at]}`).join("\n\n---\n\n");
};

export const clearWebCache = (): void => cache.clear();

export default function webFetch(g: Glorious): void {
  g.tool({
    name: "web_fetch",
    description: `Fetch web pages and return their main content as markdown, with navigation, boilerplate and markup removed. Read-only: it retrieves public pages and sends nothing. Renders with headless Chrome when one is installed, so pages that build their content with JavaScript work. Pass up to ${MAX_PAGES} URLs to fetch them together. A URL that redirects to a different host is reported rather than followed, so a login wall or shortener does not silently become the answer. Results are cached for 15 minutes.`,
    input: g.z.object({
      urls: g.z
        .array(g.z.string().min(1))
        .min(1)
        .max(MAX_PAGES)
        .describe("Absolute http(s) URLs to fetch"),
    }),
    execute: (input, signal) => fetchPages(input.urls, signal),
    renderCall: ({ urls }) => [
      [
        { text: "web_fetch " },
        {
          text: urls.length === 1 ? urls[0] : `${urls.length} pages`,
          tone: "muted",
        },
      ],
    ],
  });
}
