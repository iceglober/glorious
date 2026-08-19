import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingTools } from "./tools";

const dir = await mkdtemp(join(tmpdir(), "glrs-edit-"));
// The tools take their scope rather than computing it, so a test hands them one
// and never has to know where the host keeps its documentation.
const tools = Object.fromEntries(
  createCodingTools(dir, { read: [], write: [] }).map((spec) => [spec.name, spec]),
);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const execute = tools.edit?.execute as (i: unknown, o: unknown) => Promise<string>;

// A registered tool goes through wrapTool, which turns a throw into the
// "ERROR: …" string the model reads. These specs are raw, so the harness does
// that one thing rather than every assertion below learning about it — what is
// under test here is which edits reach disk, not how a failure is worded.
const failed = (thrown: unknown): string =>
  `ERROR: ${thrown instanceof Error ? thrown.message : String(thrown)}`;

const edit = async (path: string, edits: unknown[]): Promise<string> =>
  execute({ files: [{ path, edits }] }, {}).catch(failed);

const editFiles = async (files: unknown[]): Promise<string> => execute({ files }, {}).catch(failed);

const fixture = async (name: string, body: string): Promise<string> => {
  await writeFile(join(dir, name), body);
  return name;
};

describe("batched edits", () => {
  test("applies several replacements to one file in a single call", async () => {
    const name = await fixture("many.txt", "alpha\nbravo\ncharlie\n");
    const out = await edit(name, [
      { old_string: "alpha", new_string: "ALPHA" },
      { old_string: "charlie", new_string: "CHARLIE" },
    ]);
    expect(out).not.toStartWith("ERROR:");
    expect(await readFile(join(dir, name), "utf8")).toBe("ALPHA\nbravo\nCHARLIE\n");
  });

  test("each edit sees the result of the one before it", async () => {
    const name = await fixture("chain.txt", "one\n");
    await edit(name, [
      { old_string: "one", new_string: "two" },
      { old_string: "two", new_string: "three" },
    ]);
    expect(await readFile(join(dir, name), "utf8")).toBe("three\n");
  });
});

describe("atomicity — the property that makes batching safe", () => {
  test("a later failure leaves none of the earlier edits on disk", async () => {
    const body = "keep\nchange me\n";
    const name = await fixture("atomic.txt", body);
    const out = await edit(name, [
      { old_string: "change me", new_string: "changed" },
      { old_string: "nowhere to be found", new_string: "x" },
    ]);
    expect(out).toStartWith("ERROR:");
    expect(await readFile(join(dir, name), "utf8")).toBe(body);
  });
});

describe("what the model is told when an edit fails", () => {
  test("a non-unique old_string reports how many times it occurs", async () => {
    const name = await fixture("dupes.txt", "x = 1\ny = 2\nx = 1\nz = 3\nx = 1\n");
    const out = await edit(name, [{ old_string: "x = 1", new_string: "x = 9" }]);
    expect(out).toContain("occurs 3 times");
    expect(out).toContain("replace_all");
  });

  test("replace_all takes every occurrence instead", async () => {
    const name = await fixture("all.txt", "a\na\na\n");
    await edit(name, [{ old_string: "a", new_string: "b", replace_all: true }]);
    expect(await readFile(join(dir, name), "utf8")).toBe("b\nb\nb\n");
  });

  test("a first-edit miss does not blame earlier edits", async () => {
    const name = await fixture("first.txt", "hello\n");
    const out = await edit(name, [{ old_string: "absent", new_string: "x" }]);
    expect(out).toContain("not found");
    expect(out).not.toContain("earlier edits");
  });

  test("a later miss says the earlier edits already changed the text", async () => {
    // the commonest batch confusion: an old_string that matched the file on
    // disk but not the text the previous edit produced
    const name = await fixture("later.txt", "foo\n");
    const out = await edit(name, [
      { old_string: "foo", new_string: "bar" },
      { old_string: "foo", new_string: "baz" },
    ]);
    expect(out).toContain("earlier edits in this call");
  });

  test("the failing edit is identified by position in the batch", async () => {
    const name = await fixture("which.txt", "p\nq\n");
    const out = await edit(name, [
      { old_string: "p", new_string: "P" },
      { old_string: "q", new_string: "Q" },
      { old_string: "missing", new_string: "x" },
    ]);
    expect(out).toContain("3/3");
  });
});

describe("how the file is replaced", () => {
  test("permissions survive the swap", async () => {
    const name = await fixture("perms.sh", "#!/bin/sh\necho old\n");
    const full = join(dir, name);
    await chmod(full, 0o755);
    await edit(name, [{ old_string: "old", new_string: "new" }]);
    expect((await stat(full)).mode & 0o777).toBe(0o755);
  });

  test("no temporary file is left behind", async () => {
    const name = await fixture("tidy.txt", "a\n");
    await edit(name, [{ old_string: "a", new_string: "b" }]);
    expect((await readdir(dir)).filter((f) => f.includes("glrs-"))).toHaveLength(0);
  });

  test("a failed edit leaves neither a change nor a stray temp file", async () => {
    const name = await fixture("failed.txt", "a\n");
    await edit(name, [{ old_string: "nope", new_string: "b" }]);
    expect(await readFile(join(dir, name), "utf8")).toBe("a\n");
    expect((await readdir(dir)).filter((f) => f.includes("glrs-"))).toHaveLength(0);
  });
});

describe("the file is swapped, not truncated", () => {
  // The distinguishing observable: renaming a new file over the target gives a
  // different inode, while writing in place keeps it. In-place truncation is
  // what makes a crash mid-write able to leave a half-written file.
  test("the target's inode changes, showing a rename rather than a rewrite", async () => {
    const name = await fixture("inode.txt", "before\n");
    const full = join(dir, name);
    const was = (await stat(full)).ino;
    await edit(name, [{ old_string: "before", new_string: "after" }]);
    expect(await readFile(full, "utf8")).toBe("after\n");
    expect((await stat(full)).ino).not.toBe(was);
  });
});

describe("across files", () => {
  test("one call changes several files", async () => {
    const a = await fixture("m1.txt", "alpha\n");
    const b = await fixture("m2.txt", "bravo\n");
    const out = await editFiles([
      { path: a, edits: [{ old_string: "alpha", new_string: "ALPHA" }] },
      { path: b, edits: [{ old_string: "bravo", new_string: "BRAVO" }] },
    ]);
    expect(out).not.toStartWith("ERROR:");
    expect(await readFile(join(dir, a), "utf8")).toBe("ALPHA\n");
    expect(await readFile(join(dir, b), "utf8")).toBe("BRAVO\n");
  });

  test("a failure in the last file leaves the earlier ones untouched", async () => {
    const a = await fixture("r1.txt", "keep\n");
    const b = await fixture("r2.txt", "keep\n");
    const out = await editFiles([
      { path: a, edits: [{ old_string: "keep", new_string: "changed" }] },
      { path: b, edits: [{ old_string: "absent", new_string: "x" }] },
    ]);
    expect(out).toStartWith("ERROR:");
    expect(await readFile(join(dir, a), "utf8")).toBe("keep\n");
    expect(await readFile(join(dir, b), "utf8")).toBe("keep\n");
  });

  test("the failing file is named", async () => {
    const a = await fixture("n1.txt", "one\n");
    const b = await fixture("n2.txt", "two\n");
    const out = await editFiles([
      { path: a, edits: [{ old_string: "one", new_string: "1" }] },
      { path: b, edits: [{ old_string: "nope", new_string: "x" }] },
    ]);
    expect(out).toContain("n2.txt");
    expect(out).toContain("2/2");
  });

  test("a missing file fails the whole call, changing nothing", async () => {
    const a = await fixture("s1.txt", "here\n");
    const out = await editFiles([
      { path: a, edits: [{ old_string: "here", new_string: "gone" }] },
      { path: "does-not-exist.txt", edits: [{ old_string: "x", new_string: "y" }] },
    ]);
    expect(out).toStartWith("ERROR:");
    expect(await readFile(join(dir, a), "utf8")).toBe("here\n");
  });
});
