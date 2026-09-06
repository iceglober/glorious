export { PREAMBLE_TAGS } from "./events";

export const fence = (tag: string, body: string): string =>
  `<${tag}>\n${body.replaceAll(`</${tag}>`, `<∕${tag}>`)}\n</${tag}>`;

// Every block the agent prepends to a user turn. events.ts strips these when
// replaying a transcript, so a new preamble block must be named here or it will
// show up in the session log as if the user typed it.
export const REMINDER_OPEN = "[system-reminder]";
export const REMINDER_CLOSE = "[/system-reminder]";

export const reminder = (body: string): string =>
  `${REMINDER_OPEN}\n${body.replaceAll(REMINDER_CLOSE, "[∕system-reminder]")}\n${REMINDER_CLOSE}`;

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
