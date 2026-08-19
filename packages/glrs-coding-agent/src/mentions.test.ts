import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandMentions, fileCandidates, forgetListings, mentioned } from "./mentions";

// A tree deep enough and wide enough to catch what the hand-walk got wrong: a
// file below the old six-level ceiling, and more entries than the old 400-entry
// budget, so anything that stops early cannot see the end of it.
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mentions-"));
  await Bun.write(join(root, "README.md"), "# top");
  await Bun.write(join(root, "src", "index.ts"), "top of src");
  await Bun.write(join(root, "src", "deep", "a", "b", "c", "d", "e", "buried.ts"), "very deep");
  await Bun.write(join(root, "src", "utils.ts"), "shallow util");
  await Bun.write(join(root, "test", "a", "b", "util-helper.ts"), "deep util");
  await Bun.write(join(root, "node_modules", "junk", "index.js"), "should never appear");
  for (let n = 0; n < 500; n += 1) await Bun.write(join(root, "many", `file${n}.txt`), `${n}`);
  await Bun.write(join(root, "many", "needle-at-the-end.txt"), "findable");
  forgetListings();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("finding what @ should offer", () => {
  test("a file seven levels down is a candidate", async () => {
    expect(await fileCandidates(root, "buried")).toContain(
      join("src", "deep", "a", "b", "c", "d", "e", "buried.ts"),
    );
  });

  // The old walk stopped after 400 entries, whichever 400 readdir reached
  // first, so a file could be visible in an editor and absent from `@`.
  test("a file past the five-hundredth is still found", async () => {
    expect(await fileCandidates(root, "needle")).toContain(join("many", "needle-at-the-end.txt"));
  });

  test("directories are offered, not only files", async () => {
    const found = await fileCandidates(root, "src");
    expect(found).toContain(`src${"/"}`);
  });

  test("a directory query offers what is under it", async () => {
    const found = await fileCandidates(root, join("src", "deep"));
    expect(found.some((path) => path.includes("buried.ts"))).toBe(true);
  });

  test("ignored directories stay out", async () => {
    const found = await fileCandidates(root, "junk");
    expect(found.every((path) => !path.includes("node_modules"))).toBe(true);
  });

  // Sorting by depth first put test/a/b/util-helper.ts above src/utils.ts,
  // because it ranked where a file sits over what it is called.
  test("a name that starts with the query wins over a deeper path match", async () => {
    const found = await fileCandidates(root, "util");
    expect(found[0]).toBe(join("src", "utils.ts"));
  });

  test("more than eight matches are returned, so there is something to scroll", async () => {
    expect((await fileCandidates(root, "file")).length).toBeGreaterThan(8);
  });

  test("the listing is re-taken once it goes stale", async () => {
    const now = Date.now();
    await fileCandidates(root, "", 50, now);
    await Bun.write(join(root, "brand-new.ts"), "added after the first listing");
    expect(await fileCandidates(root, "brand-new", 50, now)).toEqual([]);
    expect(await fileCandidates(root, "brand-new", 50, now + 10_000)).toContain("brand-new.ts");
  });
});

describe("what a mention attaches", () => {
  test("a file rides along with its contents", async () => {
    const { prompt, attached } = await expandMentions(root, "look at @README.md");
    expect(attached).toEqual(["README.md"]);
    expect(prompt).toContain("# top");
  });

  // Completing to a directory and then being told it does not exist is the
  // worst of both.
  test("a directory rides along as a listing, not as missing", async () => {
    const { prompt, attached, missing } = await expandMentions(root, "look at @src");
    expect(missing).toEqual([]);
    expect(attached).toEqual(["src"]);
    expect(prompt).toContain('<directory path="src">');
    expect(prompt).toContain(join("src", "index.ts"));
    // a listing, not the bytes of every file under it
    expect(prompt).not.toContain("very deep");
  });

  test("a path that does not exist is still reported missing", async () => {
    const { missing } = await expandMentions(root, "look at @nope.ts");
    expect(missing).toEqual(["nope.ts"]);
  });

  test("an email address is left as text", async () => {
    const { attached, missing } = await expandMentions(root, "mail austin@iceglobe.io");
    expect(attached).toEqual([]);
    expect(missing).toEqual([]);
  });

  test("a path escaping the root is left as text", async () => {
    expect(mentioned("see @../../etc/passwd")).toEqual(["../../etc/passwd"]);
    const { attached, missing } = await expandMentions(root, "see @../../etc/passwd");
    expect(attached).toEqual([]);
    expect(missing).toEqual([]);
  });
});
