import type { PlanVerdict } from "./tools";

// The approval prompt is the ask_user widget with a fixed set of choices, so
// the labels are shared between what is shown and what is parsed back.
export const PLAN_QUESTION = "Ready to implement?";
export const PLAN_FRESH = "Looks good — implement (fresh context)";
export const PLAN_KEEP = "Looks good — implement (keep context)";
export const PLAN_FEEDBACK = "I have feedback";
export const PLAN_OPTIONS = [PLAN_FRESH, PLAN_KEEP, PLAN_FEEDBACK];

type Answered = { answers?: Array<{ option: string | null; note?: string }> };

// Esc, an abort, or a malformed reply all mean the same thing: nobody decided,
// so nothing should change. Only an explicit approval starts the work.
export const planVerdict = (raw: string): PlanVerdict => {
  let parsed: Answered & { cancelled?: boolean };
  try {
    parsed = JSON.parse(raw) as Answered & { cancelled?: boolean };
  } catch {
    return { decision: "cancelled" };
  }
  if (parsed.cancelled === true) return { decision: "cancelled" };
  const answer = parsed.answers?.[0];
  if (!answer) return { decision: "cancelled" };
  const note = answer.note?.trim() ?? "";
  if (answer.option === PLAN_FRESH) return { decision: "approved", fresh: true };
  if (answer.option === PLAN_KEEP) return { decision: "approved", fresh: false };
  // A note typed without touching the options is feedback — the widget reports
  // no option in that case, and treating it as approval would be the one
  // mistake here that cannot be taken back.
  if (note !== "") return { decision: "feedback", note };
  if (answer.option === PLAN_FEEDBACK)
    return { decision: "feedback", note: "(none given — ask what they want changed)" };
  return { decision: "cancelled" };
};

export const planBlock = (plan: string, files: string[]): string =>
  files.length === 0 ? plan : `${plan}\n\n${files.map((file) => `· ${file}`).join("\n")}`;
