/**
 * Model-specific prompt addenda: bare-minimum guidance appended to the system
 * prompt to correct a behavior the base prompt doesn't cover for a given model
 * family. Matched against the COMPLETE `provider/model` ref, so a family is
 * caught across providers — e.g. both `vertex/gemini-3.1-pro-preview` and
 * `google/gemini-3.6-flash` match the Gemini rule.
 *
 * Keep each addendum as short as possible; this is a targeted hedge, not a place
 * to accrete general guidance (that belongs in the base prompt or a profile).
 */
export interface PromptAddendum {
  /** Tested against the full `provider/model` ref. */
  match: RegExp;
  text: string;
}

export const PROMPT_ADDENDA: PromptAddendum[] = [
  {
    // Gemini (any provider) over-eagerly dispatches background jobs for plain
    // questions. It may choose to start one — clarify the good reasons so it
    // reserves the tool for genuinely detached work.
    match: /(?:^|\/)gemini/i,
    text: "You may start a background job on your own — but only when the user explicitly asks for background or parallel work, or when work genuinely must run detached, for example waiting on a CI run, a code review, or a deploy. For a question, answer directly. For work this turn needs — even if it is long or splits into parallel parts — delegate with run_one_subagent or run_subagents instead of calling run_background_job.",
  },
];

/** Concatenated addenda whose pattern matches the `provider/model` ref (""  none). */
export const modelAddendum = (modelRef: string): string =>
  PROMPT_ADDENDA.filter((a) => a.match.test(modelRef))
    .map((a) => a.text)
    .join("\n\n");
