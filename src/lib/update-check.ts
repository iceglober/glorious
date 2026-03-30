import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { VERSION } from "./version.js";
import { warn } from "./fmt.js";

const CACHE_FILE = path.join(os.homedir(), ".cache", "aflow", "latest-version.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedVersion {
  version: string;
  checkedAt: number;
}

function readCache(): CachedVersion | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data: CachedVersion = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    if (Date.now() - data.checkedAt < CACHE_TTL_MS) return data;
    return null; // expired
  } catch {
    return null;
  }
}

function writeCache(version: string): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version, checkedAt: Date.now() }));
  } catch {
    // best-effort — don't crash if we can't write cache
  }
}

function fetchLatestVersion(): string | null {
  try {
    const out = execFileSync(
      "gh",
      ["release", "list", "-R", "iceglober/aflow", "--json", "tagName", "-L", "10"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    ).trim();
    if (!out) return null;
    const releases: Array<{ tagName: string }> = JSON.parse(out);
    const match = releases.find((r) => r.tagName.startsWith("v"));
    return match ? match.tagName.slice(1) : null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Check if a newer version is available. Uses a 24h cache.
 * Prints a warning if behind, nothing if up-to-date.
 * Never throws — all errors are silently swallowed.
 */
export function checkForUpdate(): void {
  try {
    let latest: string | null = null;

    const cached = readCache();
    if (cached) {
      latest = cached.version;
    } else {
      latest = fetchLatestVersion();
      if (latest) writeCache(latest);
    }

    if (latest && compareVersions(latest, VERSION) > 0) {
      warn(`aflow v${latest} available (current: v${VERSION}) — run \`af upgrade\``);
    }
  } catch {
    // never crash the CLI for a version check
  }
}
