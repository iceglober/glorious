import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A NUL byte reached v2/bundled/builtins.ts as a sentinel — `process.env.HOME ??
// "\0"`, chosen because no path starts with one. It was harmless at runtime and
// invisible on screen, and it made the whole file *binary* to ripgrep: every
// search of it, by a person or by glorious's own grep tool, silently found
// nothing. A file the agent cannot search is a file the agent cannot maintain.
const here = import.meta.dir;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return entry.endsWith(".ts") ? [full] : [];
  });

// Tab, newline and carriage return are the ones that legitimately appear in
// source. Written by code point rather than as a character class, because a
// regex literal spelling out what it bans would contain what it bans.
const ALLOWED = new Set([9, 10, 13]);

const stray = (text: string): boolean => {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 127 || (code < 32 && !ALLOWED.has(code))) return true;
  }
  return false;
};

describe("the source stays searchable", () => {
  test("no file carries an invisible control character", () => {
    const guilty = sources(here)
      .filter((path) => stray(readFileSync(path, "utf8")))
      .map((path) => path.slice(here.length + 1));
    expect(guilty).toEqual([]);
  });

  test("the check has teeth", () => {
    expect(stray(`a${String.fromCharCode(0)}b`)).toBe(true);
    expect(stray(`a${String.fromCharCode(27)}[0m`)).toBe(true);
    expect(stray("a\tb\nc\r\n")).toBe(false);
    expect(stray("plain source")).toBe(false);
  });
});
