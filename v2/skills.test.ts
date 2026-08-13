import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig, McpSession } from "./mcp";
import { loadSkills } from "./skills";

const base = await mkdtemp(join(tmpdir(), "glorious-skills-"));
// a space in the path is what catches percent-encoding of the reported directory
const root = join(base, "with space");
const skillsDir = join(root, ".glorious", "skills");
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
const frontmatterMcp = join(projectSkillsDir, "zz-frontmatter-mcp");
await mkdir(frontmatterMcp, { recursive: true });
await writeFile(
  join(frontmatterMcp, "SKILL.md"),
  `---\nname: zz-frontmatter-mcp\ndescription: Fixture skill with MCP.\nmcpServers: {"skill-server":{"command":"fixture"}}\n---\n\nBody.\n`,
);
const siblingMcp = join(projectSkillsDir, "zz-sibling-mcp");
await writeSkill(siblingMcp, "zz-sibling-mcp");
await writeFile(
  join(siblingMcp, "mcp.json"),
  JSON.stringify({ "sibling-server": { command: "fixture" } }),
);

// a skill installed by symlinking its directory in, the common dotfiles layout
const external = join(root, "external", "zz-linked-fixture");
await writeSkill(external, "zz-linked-fixture");
await symlink(external, join(skillsDir, "zz-linked-fixture"));

await symlink(join(root, "nowhere"), join(skillsDir, "zz-broken-fixture"));

const activated: Array<{ skill: string; servers: Record<string, unknown> }> = [];
const loaded = await loadSkills(root);
const loadedWithMcp = await loadSkills(root, {
  loadSkillServers: async (skill: string, servers: Record<string, McpServerConfig>) =>
    activated.push({ skill, servers }),
} as unknown as McpSession);
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

  test("requires the skill directory name to match its frontmatter", () => {
    expect(names).not.toContain("zz-rejected-fixture");
  });

  test("discovers skill MCP from frontmatter and a sibling config", () => {
    expect(names).toContain("zz-frontmatter-mcp");
    expect(names).toContain("zz-sibling-mcp");
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

  test("loads skill MCP only when the skill is activated", async () => {
    const execute = loadedWithMcp.tool?.execute as (input: { name: string }) => Promise<string>;
    expect(activated).toHaveLength(0);
    await execute({ name: "zz-frontmatter-mcp" });
    expect(activated).toEqual([
      { skill: "zz-frontmatter-mcp", servers: { "skill-server": { command: "fixture" } } },
    ]);
  });

  test("errors on an unknown skill instead of throwing", async () => {
    expect(await run("zz-does-not-exist")).toBe("ERROR: unknown skill: zz-does-not-exist");
  });
});

describe("a skill that declares a slash trigger", () => {
  const root = join(tmpdir(), `glorious-trigger-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(join(root, ".glorious", "skills", "trigfixture"), { recursive: true });
    await writeFile(
      join(root, ".glorious", "skills", "trigfixture", "SKILL.md"),
      "---\nname: trigfixture\ndescription: Build a knowledge graph\ntrigger: /trigfixture\n---\n\nRun the pipeline.",
    );
    await mkdir(join(root, ".glorious", "skills", "renamedfixture"), { recursive: true });
    await writeFile(
      join(root, ".glorious", "skills", "renamedfixture", "SKILL.md"),
      "---\nname: renamedfixture\ndescription: Answers to a different name\ntrigger: /shortname\n---\n\nBody.",
    );
    await mkdir(join(root, ".glorious", "skills", "notrigfixture"), { recursive: true });
    await writeFile(
      join(root, ".glorious", "skills", "notrigfixture", "SKILL.md"),
      "---\nname: notrigfixture\ndescription: No trigger here\n---\n\nNothing.",
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it becomes a slash command named after the trigger", async () => {
    const skills = await loadSkills(root);
    expect(skills.commands.map((command) => command.name)).toContain("trigfixture");
  });

  test("the leading slash is optional, since the frontmatter writes it either way", async () => {
    const skills = await loadSkills(root);
    expect(skills.commands.find((command) => command.name === "trigfixture")).toBeDefined();
    expect(skills.commands.some((command) => command.name === "/trigfixture")).toBe(false);
  });

  test("running it injects the skill body, rather than hoping the model loads it", async () => {
    const skills = await loadSkills(root);
    const command = skills.commands.find((entry) => entry.name === "trigfixture");
    expect(command?.body).toContain("Run the pipeline.");
    expect(command?.body).toContain("Skill directory:");
  });

  test("a skill without a trigger is still reachable, under its own name", async () => {
    // graphify 0.9.41 dropped its `trigger:` field and lost /graphify entirely;
    // a skill's command cannot depend on an optional field staying put
    const skills = await loadSkills(root);
    expect(skills.commands.map((command) => command.name)).toContain("notrigfixture");
  });

  test("a trigger renames the command rather than granting it", async () => {
    const skills = await loadSkills(root);
    const names = skills.commands.map((command) => command.name);
    // the skill is named renamedfixture but answers to /shortname
    expect(names).toContain("shortname");
    expect(names).not.toContain("renamedfixture");
    expect(skills.summaries.map((summary) => summary.name)).toContain("renamedfixture");
  });
});

describe("what a triggered skill actually sends", () => {
  const root = join(tmpdir(), `glorious-framing-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(join(root, ".glorious", "skills", "framefixture"), { recursive: true });
    await writeFile(
      join(root, ".glorious", "skills", "framefixture", "SKILL.md"),
      "---\nname: framefixture\ndescription: Does a thing\ntrigger: /framefixture\n---\n\nStep 1. Do it.",
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("it is framed as an instruction, not handed over as reference material", async () => {
    const skills = await loadSkills(root);
    const body = skills.commands.find((entry) => entry.name === "framefixture")?.body ?? "";
    // bare skill_content made the model reply "what would you like me to work on?"
    expect(body.startsWith("<skill_content")).toBe(false);
    expect(body).toMatch(/^Run the framefixture skill now/u);
  });

  test("the instructions themselves still arrive intact", async () => {
    const skills = await loadSkills(root);
    const body = skills.commands.find((entry) => entry.name === "framefixture")?.body ?? "";
    expect(body).toContain("Step 1. Do it.");
    expect(body).toContain("<skill_content");
  });
});
