import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./skills";
import { createTools } from "./tools";

const dir = await mkdtemp(join(tmpdir(), "glorious-edit-"));
const skills = await loadSkills(process.cwd());
const tools = createTools(dir, () => {}, null, skills);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const edit = async (path: string, edits: unknown[]): Promise<string> => {
  const execute = tools.edit?.execute as (i: unknown, o: unknown) => Promise<string>;
  return execute({ path, edits }, {});
};

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
