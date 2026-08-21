/**
 * The toolbar star count. Fetched once at build time and baked into every
 * page, so a visitor makes no request of their own and the site still builds
 * offline, rate-limited, or behind a firewall.
 */

/** Below this the badge is not rendered at all. A project advertising zero
 * stars is worse off than one saying nothing. */
export const MINIMUM_STARS = 1;

/**
 * The `owner/name` a GitHub URL points at, or null for anything else.
 * The repository is read from typedoc.json's `navigationLinks.github`, so
 * renaming the repo stays a one-line change in one file.
 */
export const repoFromUrl = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const [owner, name] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !name) return null;
  return `${owner}/${name.replace(/\.git$/u, "")}`;
};

/** GitHub's own rounding: 999, 1.2k, 12.3k, 123k. */
export const formatStars = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 100_000) return `${(count / 1000).toFixed(1).replace(/\.0$/u, "")}k`;
  return `${Math.round(count / 1000)}k`;
};

/**
 * The star count, or null if it cannot be had. Every failure returns null
 * rather than throwing: the badge is decoration, and a docs deploy must not
 * fail because GitHub rate-limited the runner. GITHUB_TOKEN is used when
 * present, since CI runners share an IP and the anonymous cap is 60/hour.
 */
export const fetchStars = async (
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> => {
  const token = process.env.GITHUB_TOKEN;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { stargazers_count?: unknown };
    const count = body.stargazers_count;
    return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
};
