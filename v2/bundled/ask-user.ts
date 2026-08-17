import type { Glorious } from "../extension-api";

// The `ask_user` tool, which used to be built in. It is here to keep the core
// to the six tools that touch the machine — bash, read, write, edit, grep,
// glob — and because a tool that opens a widget and waits for a person is
// exactly the kind of thing the extension API exists to make possible. If it
// could not be written against `g`, "extensible" would be a claim rather than a
// fact.
//
// It registers only when there is somebody to answer. In print mode `g.ask`
// throws, so a registered tool would hang the model on a question that can
// never be answered, and it would retry until something timed out. Withholding
// the tool tells the model the option does not exist, which is the honest
// version of the same thing.
//
// Shadow it with `.glorious/extensions/ask-user.ts`, or delete it and the model
// simply stops being able to ask.

export default function askUser(g: Glorious): void {
  if (!g.hasUI) return;

  g.tool({
    name: "ask_user",
    description:
      "Ask the user one or more questions. Each question must include concise options. The user can choose an option, add a note, or do both. Ask related questions together so the user can answer them in one batch. Use the answers to continue the current task.",
    input: g.z.object({
      questions: g.z
        .array(
          g.z.object({
            question: g.z.string().min(1).describe("Question to show the user"),
            options: g.z.array(g.z.string().min(1)).min(1).max(10).describe("Selectable answers"),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ questions }) => g.ask(questions),
    // The row says what was asked, not that a tool ran. A question is the one
    // tool call the user was part of, so echoing it is the whole of the row.
    renderCall: (input) => [
      [
        {
          text:
            input.questions.length === 1
              ? g.clip(input.questions[0].question, 72)
              : `${input.questions.length} questions`,
          tone: "accent",
        },
      ],
    ],
  });

  // The guidance travels with the tool. It used to sit in the core prompt,
  // which meant deleting the tool left the model instructed to use something
  // that no longer existed.
  g.prompt(
    "Use ask_user when intent, scope, or a material choice is uncertain, and always when you would otherwise offer the user options in prose.",
  );
}
