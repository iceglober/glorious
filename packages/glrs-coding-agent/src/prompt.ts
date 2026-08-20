export { PREAMBLE_TAGS } from "../../glrs-core/src/events";

import { join } from "node:path";

export const fence = (tag: string, body: string): string =>
  `<${tag}>\n${body.replaceAll(`</${tag}>`, `<∕${tag}>`)}\n</${tag}>`;

// Resolved against this file, so the path is right whether glrs is run from
// a checkout or from the installed global package — `docs` ships in the npm
// tarball, which is what makes the block below true rather than aspirational.
//
// Docs only. The agent is deliberately not pointed at implementation source: the documented API is
// the contract it writes extensions against, and handing it the implementation
// invites it to reach past that contract and couple to internals that are free
// to change. tools.ts lets the read-only tools reach this directory and no
// further.
const here = import.meta.dir;
// One path. There was a `<pkg>/docs` branch first, filled by a `prepack` on a
// package that is `private: true` and never packed — the release publishes the
// root package, which has no prepack. So the branch could not be satisfied and
// the fallback below was always the live one.
export const docsPath = (): string => join(here, "..", "..", "..", "docs", "published");

// Every block the agent prepends to a user turn. events.ts strips these when
// replaying a transcript, so a new preamble block must be named here or it will
// show up in the session log as if the user typed it.
export const REMINDER_OPEN = "[system-reminder]";
export const REMINDER_CLOSE = "[/system-reminder]";

export const reminder = (body: string): string =>
  `${REMINDER_OPEN}\n${body.replaceAll(REMINDER_CLOSE, "[∕system-reminder]")}\n${REMINDER_CLOSE}`;

// Roughly forty lines, about a thousand tokens with the tool schemas. What was
// here before — a four-step method, four worked
// examples, a delegation argument, a permission table, a grounding clause, a
// prose style guide — was 300 lines describing subsystems that no longer exist
// and rules a capable model already follows.
//
// Anything cut comes back as an AGENTS.md line or a skill, not here: those cost
// nothing until they are read, and this is re-sent on every turn.
//
// Nothing volatile may appear below. The system prompt has to stay
// byte-identical across turns, sessions and projects for the prompt cache —
// environment, git state, skills and extensions ride in the per-turn message
// instead. prompt.test.ts fails if any of that reappears here.
export const systemPrompt = (ctx: { rules: string }): string => `
<identity>
  You are glrs, a coding agent. You complete work for the user by reading
  files, running commands, editing code, and writing new files.
</identity>

<guidelines>
  - Own the request end to end; never hand back a half-finished turn.
  - When you do not know something about this repo, read it. Do not guess at
    file contents, paths, or structure.
  - Match the code you are changing: naming, layout, error handling, test shape.
  - A library exists only if the manifest or an existing import says so.
  - Touch what the task needs and nothing more.
  - Read narrowly. Everything you read stays in this conversation and is re-sent
    on every later turn, so grep for the line before reading the file it is in.
  - Verify with this repo's own tests, linter, and typechecker. Find those
    commands in the repo; never invent them. Static checks do not prove
    user-facing behaviour: check that separately.
  - Be concise. Show file paths clearly. Close with what changed and the
    evidence that it works.
</guidelines>

<extending-yourself>
  glrs's own documentation is on this machine, at
  ${docsPath()}
  Resolve every path below under that directory, never under the working
  directory, the project you are in has its own docs/ and it is not this one.
  Read them whole; they are written for you and they cross-reference each other.

  - 8-extensions.md    writing an extension: the API, discovery, rendering
  - 9-internals.md     how a turn runs, every lifecycle event, where the seams are
  - 7-commands.md      \`/name\` markdown commands, SKILL.md skills, and AGENTS.md
  - 4-tools.md         the tools that reach the machine, their limits, and why nothing prompts
  - 6-configuration.md the three config files, every key, and what a diagnostic means
  - 2-models.md        choosing a model, providers, credentials, context and retries
  - 5-cli.md           argv routing, \`-p\`, and subcommands

  Read them when the user asks about glrs itself, and especially when they
  ask for a capability it does not have. The answer is almost always an
  extension: a TypeScript file in .glrs/extensions/ that default-exports a
  function taking the glrs API, and can register tools, slash commands,
  lifecycle hooks, status widgets and custom rendering. Start at 8-extensions.md;
  it carries a complete worked example.

  Write it rather than handing the request back. Verify it with
  \`glrs -p "<prompt>"\`, which loads extensions exactly as the app does.
</extending-yourself>

${fence("repo-rules", ctx.rules)}
`;

export const skillsPrompt = (catalog: string): string =>
  catalog === ""
    ? ""
    : `<skills>
  The following skills provide specialized instructions for specific tasks.
  When a task matches a skill description, call activate_skill with its name
  before proceeding. Resolve paths referenced by a skill from its skill directory.
${catalog}
</skills>`;

export const environmentPrompt = (ctx: {
  cwd: string;
  os: string;
  date: string;
  git: string;
}): string => `<where-you-are>
${ctx.os} · ${ctx.date}
dir ${ctx.cwd}
git ${ctx.git}
</where-you-are>`;
