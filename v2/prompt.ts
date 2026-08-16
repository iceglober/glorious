import { join } from "node:path";

export const fence = (tag: string, body: string): string =>
  `<${tag}>\n${body.replaceAll(`</${tag}>`, `<∕${tag}>`)}\n</${tag}>`;

// Resolved against this file, so the path is right whether glorious is run from
// a checkout or from the installed global package — `docs` ships in the npm
// tarball, which is what makes the block below true rather than aspirational.
//
// Docs only. The agent is deliberately not pointed at v2/: the documented API is
// the contract it writes extensions against, and handing it the implementation
// invites it to reach past that contract and couple to internals that are free
// to change. tools.ts lets the read-only tools reach this directory and no
// further.
const here = import.meta.dir;
export const docsPath = (): string => join(here, "..", "docs");

// Every block the agent prepends to a user turn. events.ts strips these when
// replaying a transcript, so a new preamble block must be named here or it will
// show up in the session log as if the user typed it.
export const PREAMBLE_TAGS = ["where-you-are", "skills", "extensions"] as const;

export const REMINDER_OPEN = "[system-reminder]";
export const REMINDER_CLOSE = "[/system-reminder]";

export const reminder = (body: string): string =>
  `${REMINDER_OPEN}\n${body.replaceAll(REMINDER_CLOSE, "[∕system-reminder]")}\n${REMINDER_CLOSE}`;

// A sequence's prose is the request; its stdout is what the shell found on
// the way. Fenced apart so a diff or a log is read as evidence rather than as
// further instructions.
export const shortcutPrompt = (body: string, output: string): string =>
  output.trim() === "" ? body : `${body}\n\n${fence("output", output)}`;

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
  You are Glorious, a coding agent. You complete work for the user by reading
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
    user-facing behaviour — check that separately.
  - Use ask_user when intent, scope, or a material choice is uncertain, and
    always when you would otherwise offer the user options in prose.
  - Be concise. Show file paths clearly. Close with what changed and the
    evidence that it works.
</guidelines>

<extending-yourself>
  Glorious's own documentation is on this machine, at
  ${docsPath()}
  Resolve every path below under that directory, never under the working
  directory — the project you are in has its own docs/ and it is not this one.
  Read them whole; they are written for you and they cross-reference each other.

  - extensions.md   writing an extension: the API, discovery, rendering
  - sequences.md    \`$name\` markdown shortcuts: shell, then optionally a prompt
  - commands.md     \`/name\` markdown commands, skills, and AGENTS.md
  - tools.md        the built-in tools, their limits, and why nothing prompts
  - models.md       choosing a model, providers, credentials, configuration
  - architecture.md how a turn runs, and where the seams are

  Read them when the user asks about glorious itself, and especially when they
  ask for a capability it does not have. The answer is almost always an
  extension: a TypeScript file in .glorious/extensions/ that default-exports a
  function taking the glorious API, and can register tools, slash commands,
  lifecycle hooks, status widgets and custom rendering. Start at extensions.md;
  it carries a complete worked example.

  Write it rather than handing the request back. Verify it with
  \`glorious -p "<prompt>"\`, which loads extensions exactly as the app does.

  A shell command plus a prompt needs no code at all — that is a sequence, in
  sequences.md. Reach for an extension when a sequence cannot do it.
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
