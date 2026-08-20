import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "./skills";

const base = await mkdtemp(join(tmpdir(), "glrs-skills-"));
// Skills are searched for under the home directory as well as the project, so
// every load here is given an empty scratch home. Without it the suite reads
// whatever skills are actually installed on the machine running it — green on
// CI, red on any laptop that has some.
const noHome = join(base, "home");
// a space in the path is what catches percent-encoding of the reported directory
const root = join(base, "with space");
const skillsDir = join(root, ".glrs", "skills");
const projectSkillsDir = join(root, ".agents", "skills");

const writeSkill = async (dir: string, name: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Fixture skill ${name}.\n---\n\nBody of ${name}.\n`,
  );
};

await writeSkill(join(skillsDir, "zz-plain-fixture"), "zz-plain-fixture");
await writeSkill(join(projectSkillsDir, "zz-project-fixture"), "zz-project-fixture");
await writeSkill(join(projectSkillsDir, "wrong-directory"), "zz-rejected-fixture");
// a skill installed by symlinking its directory in, the common dotfiles layout
const external = join(root, "external", "zz-linked-fixture");
await writeSkill(external, "zz-linked-fixture");
await symlink(external, join(skillsDir, "zz-linked-fixture"));

await symlink(join(root, "nowhere"), join(skillsDir, "zz-broken-fixture"));

const loaded = await loadSkills(root, noHome);
const names = loaded.summaries.map((skill) => skill.name);

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("discover", () => {
  test("finds a skill in a plain directory", () => {
    expect(names).toContain("zz-plain-fixture");
  });

  test("finds project skills before the compatibility directory", () => {
    expect(names).toContain("zz-project-fixture");
  });

  // It used to be dropped outright, so renaming a folder made a skill vanish
  // with nothing said. The frontmatter names the skill; the folder is where it
  // happens to live.
  test("a skill in a differently-named directory loads, and says so", () => {
    expect(names).toContain("zz-rejected-fixture");
    expect(loaded.warnings.join("\n")).toContain('named "zz-rejected-fixture" but sits in');
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

describe("a skill that declares a slash trigger", () => {
  const root = join(tmpdir(), `glrs-trigger-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(join(root, ".glrs", "skills", "trigfixture"), { recursive: true });
    await writeFile(
      join(root, ".glrs", "skills", "trigfixture", "SKILL.md"),
      "---\nname: trigfixture\ndescription: Build a knowledge graph\ntrigger: /trigfixture\n---\n\nRun the pipeline.",
    );
    await mkdir(join(root, ".glrs", "skills", "renamedfixture"), { recursive: true });
    await writeFile(
      join(root, ".glrs", "skills", "renamedfixture", "SKILL.md"),
      "---\nname: renamedfixture\ndescription: Answers to a different name\ntrigger: /shortname\n---\n\nBody.",
    );
    await mkdir(join(root, ".glrs", "skills", "notrigfixture"), { recursive: true });
    await writeFile(
      join(root, ".glrs", "skills", "notrigfixture", "SKILL.md"),
      "---\nname: notrigfixture\ndescription: No trigger here\n---\n\nNothing.",
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it becomes a slash command named after the trigger", async () => {
    const skills = await loadSkills(root, noHome);
    expect(skills.commands.map((command) => command.name)).toContain("skill:trigfixture");
  });

  test("the leading slash is optional, since the frontmatter writes it either way", async () => {
    const skills = await loadSkills(root, noHome);
    expect(skills.commands.find((command) => command.name === "skill:trigfixture")).toBeDefined();
    expect(skills.commands.some((command) => command.name === "/trigfixture")).toBe(false);
  });

  test("running it injects the skill body, rather than hoping the model loads it", async () => {
    const skills = await loadSkills(root, noHome);
    const command = skills.commands.find((entry) => entry.name === "skill:trigfixture");
    expect(command?.body).toContain("Run the pipeline.");
    expect(command?.body).toContain("Skill directory:");
  });

  test("a skill without a trigger is still reachable, under its own name", async () => {
    // graphify 0.9.41 dropped its `trigger:` field and lost /graphify entirely;
    // a skill's command cannot depend on an optional field staying put
    const skills = await loadSkills(root, noHome);
    expect(skills.commands.map((command) => command.name)).toContain("skill:notrigfixture");
  });

  test("a trigger renames the command rather than granting it", async () => {
    const skills = await loadSkills(root, noHome);
    const names = skills.commands.map((command) => command.name);
    // the skill is named renamedfixture but answers to /shortname
    expect(names).toContain("skill:shortname");
    expect(names).not.toContain("renamedfixture");
    expect(skills.summaries.map((summary) => summary.name)).toContain("renamedfixture");
  });
});

describe("what a triggered skill actually sends", () => {
  const root = join(tmpdir(), `glrs-framing-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(join(root, ".glrs", "skills", "framefixture"), { recursive: true });
    await writeFile(
      join(root, ".glrs", "skills", "framefixture", "SKILL.md"),
      "---\nname: framefixture\ndescription: Does a thing\ntrigger: /framefixture\n---\n\nStep 1. Do it.",
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it is framed as an instruction, not handed over as reference material", async () => {
    const skills = await loadSkills(root, noHome);
    const body = skills.commands.find((entry) => entry.name === "skill:framefixture")?.body ?? "";
    // bare skill_content made the model reply "what would you like me to work on?"
    expect(body.startsWith("<skill_content")).toBe(false);
    expect(body).toMatch(/^Run the framefixture skill now/u);
  });

  test("the instructions themselves still arrive intact", async () => {
    const skills = await loadSkills(root, noHome);
    const body = skills.commands.find((entry) => entry.name === "skill:framefixture")?.body ?? "";
    expect(body).toContain("Step 1. Do it.");
    expect(body).toContain("<skill_content");
  });
});

// The Agent Skills standard's frontmatter, plus the one field that is not in it.
describe("frontmatter", () => {
  const load = async (frontmatter: string, name = "zz-fm") => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-fm-"));
    await mkdir(join(dir, ".glrs", "skills", name), { recursive: true });
    await writeFile(
      join(dir, ".glrs", "skills", name, "SKILL.md"),
      `---\n${frontmatter}\n---\n\nBody.\n`,
    );
    const result = await loadSkills(dir, join(dir, "home"));
    await rm(dir, { recursive: true, force: true });
    return result;
  };

  test("the standard's optional fields are carried, not dropped", async () => {
    const loaded = await load(
      [
        "name: zz-fm",
        "description: A fixture.",
        "license: MIT",
        "compatibility: needs bun",
        "allowed-tools: read grep  bash",
        "metadata:",
        "  author: austin",
        "  version: 2",
      ].join("\n"),
    );
    expect(loaded.summaries[0]).toMatchObject({
      compatibility: "needs bun",
      allowedTools: ["read", "grep", "bash"],
    });
  });

  test("a field nothing knows about is ignored rather than fatal", async () => {
    const loaded = await load("name: zz-fm\ndescription: A fixture.\ninvented-field: 3");
    expect(loaded.summaries).toHaveLength(1);
  });

  // Not part of the specification — a convention enough agents adopted that a
  // skill carrying it expects it honoured. See docs/skills.md.
  test("disable-model-invocation keeps a skill out of the model's reach", async () => {
    const loaded = await load(
      "name: zz-fm\ndescription: A fixture.\ndisable-model-invocation: true",
    );
    expect(loaded.summaries[0].modelInvocable).toBe(false);
    // absent from the preamble, so it costs nothing per turn and cannot be chosen
    expect(loaded.catalog).toBe("");
    // and absent from what activate_skill can reach
    expect(loaded.tool).toBeUndefined();
    // but still yours to type
    expect(loaded.commands.map((command) => command.name)).toEqual(["skill:zz-fm"]);
  });

  test("without the field a skill is offered to the model", async () => {
    const loaded = await load("name: zz-fm\ndescription: A fixture.");
    expect(loaded.summaries[0].modelInvocable).toBe(true);
    expect(loaded.catalog).toContain("zz-fm");
  });

  test("a skill with no description does not load, and says why", async () => {
    const loaded = await load("name: zz-fm");
    expect(loaded.summaries).toHaveLength(0);
    expect(loaded.warnings.join("\n")).toContain("no description");
  });

  // Lenient: refusing to run someone's skill over a capital letter helps nobody.
  test("a non-standard name warns and still loads", async () => {
    const loaded = await load("name: ZZ_Fm\ndescription: A fixture.", "ZZ_Fm");
    expect(loaded.summaries).toHaveLength(1);
    expect(loaded.warnings.join("\n")).toContain("not a standard skill name");
  });

  test("an oversized description warns, because it is paid for every turn", async () => {
    const loaded = await load(`name: zz-fm\ndescription: ${"x".repeat(1100)}`);
    expect(loaded.warnings.join("\n")).toContain("over the 1024");
  });

  test("a file with no frontmatter at all says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-fm-"));
    await mkdir(join(dir, ".glrs", "skills", "zz-bare"), { recursive: true });
    await writeFile(join(dir, ".glrs", "skills", "zz-bare", "SKILL.md"), "just a body\n");
    const loaded = await loadSkills(dir, join(dir, "home"));
    expect(loaded.warnings.join("\n")).toContain("no frontmatter");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("discovery reaches skills that are organised", () => {
  test("a skill nested in a folder of skills is found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-nested-"));
    const nested = join(dir, ".glrs", "skills", "writing", "deep", "zz-nested");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(nested, "SKILL.md"),
      "---\nname: zz-nested\ndescription: Buried a few folders down.\n---\n\nBody.\n",
    );
    const loaded = await loadSkills(dir, join(dir, "home"));
    expect(loaded.summaries.map((skill) => skill.name)).toContain("zz-nested");
    await rm(dir, { recursive: true, force: true });
  });

  test("a skill's own references and scripts are not searched for more skills", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-bundle-"));
    const skill = join(dir, ".glrs", "skills", "zz-bundle");
    await mkdir(join(skill, "references"), { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      "---\nname: zz-bundle\ndescription: Has bundled material.\n---\n\nBody.\n",
    );
    await writeFile(
      join(skill, "references", "SKILL.md"),
      "---\nname: zz-not-a-skill\ndescription: Reference material.\n---\n\nBody.\n",
    );
    const loaded = await loadSkills(dir, join(dir, "home"));
    const names = loaded.summaries.map((one) => one.name);
    expect(names).toContain("zz-bundle");
    expect(names).not.toContain("zz-not-a-skill");
    await rm(dir, { recursive: true, force: true });
  });

  test("two skills with one name warn, and the first found wins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-dupe-"));
    for (const where of [
      join(dir, ".agents", "skills", "zz-dupe"),
      join(dir, ".glrs", "skills", "zz-dupe"),
    ]) {
      await mkdir(where, { recursive: true });
      await writeFile(
        join(where, "SKILL.md"),
        `---\nname: zz-dupe\ndescription: From ${where}.\n---\n\nBody.\n`,
      );
    }
    const loaded = await loadSkills(dir, join(dir, "home"));
    expect(loaded.summaries.filter((one) => one.name === "zz-dupe")).toHaveLength(1);
    expect(loaded.warnings.join("\n")).toContain('two skills are named "zz-dupe"');
    await rm(dir, { recursive: true, force: true });
  });
});

describe("the four skill locations", () => {
  test("a skill in the User glrs directory is available in a project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-user-skills-"));
    const home = join(dir, "home");
    const project = join(dir, "project");
    await writeSkill(join(home, ".config", "glrs", "skills", "zz-user"), "zz-user");
    const skills = await loadSkills(project, home, {}, "linux");
    expect(skills.summaries.map((one) => one.name)).toContain("zz-user");
    await rm(dir, { recursive: true, force: true });
  });

  test("a skill in an arbitrary ancestor is not inherited", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-ancestor-skills-"));
    const project = join(dir, "nested", "project");
    await writeSkill(join(dir, ".agents", "skills", "zz-ancestor"), "zz-ancestor");
    const skills = await loadSkills(project, join(dir, "home"), {}, "linux");
    expect(skills.summaries.map((one) => one.name)).not.toContain("zz-ancestor");
    await rm(dir, { recursive: true, force: true });
  });
});

// Two things the roots list gets wrong or newly gets right. Both need a project
// that sits *inside* the home being used, which every other test in this file
// deliberately avoids — a scratch home outside the tree is what keeps them from
// reading whatever skills the machine happens to have.
describe("where skills are looked for", () => {
  const nested = async (): Promise<{ home: string; root: string }> => {
    const home = await mkdtemp(join(tmpdir(), "glrs-home-"));
    const root = join(home, "repo");
    await mkdir(root, { recursive: true });
    return { home, root };
  };

  const skillAt = async (dir: string, name: string): Promise<void> => {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(
      join(dir, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: A skill for testing where roots are read from.\n---\n\nbody\n`,
    );
  };

  // ~/.agents/skills was listed explicitly and reached again by the ancestor
  // walk, so every personal skill was found twice and warned that it collided
  // with itself — naming the same path on both sides of the sentence.
  test("a personal skill is found once, not once per path that reaches it", async () => {
    const { home, root } = await nested();
    await skillAt(join(home, ".config", "agents", "skills"), "zz-personal");
    const skills = await loadSkills(root, home, {}, "linux");
    expect(skills.summaries.filter((one) => one.name === "zz-personal")).toHaveLength(1);
    expect(skills.warnings.join("\n")).not.toContain("two skills are named");
    await rm(home, { recursive: true, force: true });
  });

  test("a skill in an extension's own directory is found", async () => {
    const { home, root } = await nested();
    const extension = join(home, "ext");
    await skillAt(join(extension, "skills"), "zz-from-extension");
    const skills = await loadSkills(root, home, [join(extension, "skills")]);
    expect(skills.summaries.map((one) => one.name)).toContain("zz-from-extension");
    await rm(home, { recursive: true, force: true });
  });

  // Appended last, so the first root to claim a name still wins. An extension
  // shipping a skill must not be able to take a name the project uses.
  test("a project skill of the same name beats the extension's", async () => {
    const { home, root } = await nested();
    const extension = join(home, "ext");
    await skillAt(join(root, ".glrs", "skills"), "zz-contested");
    await skillAt(join(extension, "skills"), "zz-contested");
    const skills = await loadSkills(root, home, [join(extension, "skills")]);
    const found = skills.summaries.filter((one) => one.name === "zz-contested");
    expect(found).toHaveLength(1);
    expect(found[0]?.location).toStartWith(root);
    await rm(home, { recursive: true, force: true });
  });

  test("an extension directory with no skills is not an error", async () => {
    const { home, root } = await nested();
    const skills = await loadSkills(root, home, [join(home, "ext", "nothing-here")]);
    expect(skills.warnings).toEqual([]);
    await rm(home, { recursive: true, force: true });
  });
});

describe("User skill directories", () => {
  test("a skill in the User glrs directory is found", async () => {
    const home = await mkdtemp(join(tmpdir(), "glrs-home-"));
    const project = await mkdtemp(join(tmpdir(), "glrs-proj-"));
    await writeSkill(
      join(home, ".config", "glrs", "skills", "zz-personal-glrs"),
      "zz-personal-glrs",
    );
    const found = await loadSkills(project, home, {}, "linux");
    expect(found.summaries.map((one) => one.name)).toContain("zz-personal-glrs");
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  test("the retired .glorious spelling is not read", async () => {
    const home = await mkdtemp(join(tmpdir(), "glrs-home2-"));
    const project = await mkdtemp(join(tmpdir(), "glrs-proj2-"));
    await writeSkill(join(home, ".glorious", "skills", "zz-personal-old"), "zz-personal-old");
    const found = await loadSkills(project, home);
    expect(found.summaries.map((one) => one.name)).not.toContain("zz-personal-old");
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  test("no root is searched twice", async () => {
    // Duplicated roots find every skill under them again and warn that two
    // skills share a name, naming the same file on both sides.
    const home = await mkdtemp(join(tmpdir(), "glrs-home3-"));
    await writeSkill(join(home, ".config", "glrs", "skills", "zz-once"), "zz-once");
    const found = await loadSkills(home, home, {}, "linux");
    expect(found.summaries.filter((one) => one.name === "zz-once")).toHaveLength(1);
    expect(found.warnings.join(" ")).not.toContain("zz-once");
    await rm(home, { recursive: true, force: true });
  });
});

describe("frontmatter a skill author sets is frontmatter something can read", () => {
  const withFields = async (frontmatter: string) => {
    const project = await mkdtemp(join(tmpdir(), "glrs-fm-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-fmh-"));
    await mkdir(join(project, ".glrs", "skills", "zz-fields"), { recursive: true });
    await writeFile(
      join(project, ".glrs", "skills", "zz-fields", "SKILL.md"),
      `---\nname: zz-fields\ndescription: Fixture.\n${frontmatter}---\n\nBody.\n`,
    );
    const found = await loadSkills(project, home);
    await rm(project, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    return found.summaries.find((one) => one.name === "zz-fields");
  };

  test("license and metadata reach the summary rather than dying in the parser", async () => {
    const skill = await withFields("license: MIT\nmetadata:\n  team: platform\n");
    expect(skill?.license).toBe("MIT");
    expect(skill?.metadata).toMatchObject({ team: "platform" });
  });

  test("allowed-tools and compatibility are carried", async () => {
    const skill = await withFields("allowed-tools: read, grep\ncompatibility: glrs>=1\n");
    expect(skill?.allowedTools).toEqual(["read", "grep"]);
    expect(skill?.compatibility).toBe("glrs>=1");
  });
});

describe("activating a skill reports what it is allowed to use", () => {
  const activate = async (frontmatter: string): Promise<string[][]> => {
    const project = await mkdtemp(join(tmpdir(), "glrs-act-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-acth-"));
    await mkdir(join(project, ".glrs", "skills", "zz-act"), { recursive: true });
    await writeFile(
      join(project, ".glrs", "skills", "zz-act", "SKILL.md"),
      `---\nname: zz-act\ndescription: Fixture.\n${frontmatter}---\n\nBody.\n`,
    );
    const seen: string[][] = [];
    const found = await loadSkills(project, home, [], (skill) =>
      seen.push([...skill.allowedTools]),
    );
    // The SDK hands execute a context this test does not need; only the
    // activation callback is under test here.
    await found.tool?.execute?.({ name: "zz-act" }, {
      toolCallId: "t",
      messages: [],
    } as never);
    await rm(project, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    return seen;
  };

  test("the list a skill declared reaches the caller that can enforce it", async () => {
    expect(await activate("allowed-tools: read, grep\n")).toEqual([["read", "grep"]]);
  });

  test("a skill that declares nothing asks for no restriction", async () => {
    expect(await activate("")).toEqual([[]]);
  });
});
