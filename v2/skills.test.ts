import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./skills";

const base = await mkdtemp(join(tmpdir(), "glorious-skills-"));
// a space in the path is what catches percent-encoding of the reported directory
const root = join(base, "with space");
const skillsDir = join(root, ".glorious", "skills");

const writeSkill = async (dir: string, name: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Fixture skill ${name}.\n---\n\nBody of ${name}.\n`,
  );
};

await writeSkill(join(skillsDir, "zz-plain-fixture"), "zz-plain-fixture");

// a skill installed by symlinking its directory in, the common dotfiles layout
const external = join(root, "external", "zz-linked-fixture");
await writeSkill(external, "zz-linked-fixture");
await symlink(external, join(skillsDir, "zz-linked-fixture"));

await symlink(join(root, "nowhere"), join(skillsDir, "zz-broken-fixture"));

const loaded = await loadSkills(root);
const names = loaded.summaries.map((skill) => skill.name);

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("discover", () => {
  test("finds a skill in a plain directory", () => {
    expect(names).toContain("zz-plain-fixture");
  });

  test("finds a skill whose directory is a symlink", () => {
    expect(names).toContain("zz-linked-fixture");
  });

  test("skips a broken symlink without throwing", () => {
    expect(names).not.toContain("zz-broken-fixture");
  });

  test("puts every discovered skill in the catalog", () => {
    expect(loaded.catalog).toContain("zz-plain-fixture");
    expect(loaded.catalog).toContain("zz-linked-fixture");
  });
});

describe("activate_skill", () => {
  const run = async (name: string): Promise<string> => {
    const execute = loaded.tool?.execute as (input: { name: string }) => Promise<string>;
    return execute({ name });
  };

  test("returns the skill body", async () => {
    expect(await run("zz-plain-fixture")).toContain("Body of zz-plain-fixture.");
  });

  test("reports the skill directory verbatim, not percent-encoded", async () => {
    const output = await run("zz-plain-fixture");
    expect(output).toContain(join(skillsDir, "zz-plain-fixture"));
    expect(output).not.toContain("%2F");
    expect(output).not.toContain("%20");
  });

  test("errors on an unknown skill instead of throwing", async () => {
    expect(await run("zz-does-not-exist")).toBe("ERROR: unknown skill: zz-does-not-exist");
  });
});
