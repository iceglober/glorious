import type { Glrs, Key, Line } from "../../../glrs-core/src";

// The `ask_user` tool, and the widget it opens. Both used to be in the core:
// the tool in tools.ts, and 234 lines of renderer code in ui/questions.ts. That
// put an opinion about what a question looks like in the part of glrs that
// cannot be replaced, for the sake of one tool.
//
// Everything here is written against `g` — `g.tool` to register, `g.ui.capture`
// to own the composer area and read keys. If a question widget could not be
// built this way, "extensible" would be a claim rather than a fact. Delete this
// file and the model simply loses the ability to ask; write your own and it is
// not competing with anything privileged.
//
// It registers only where there is somebody to answer. In print mode
// `ui.capture` throws, so a registered tool would hang the model on a question
// nobody can answer and it would retry until something timed out. Withholding
// the tool says the option does not exist, which is the honest form of the same
// thing.

type Question = { question: string; options: string[] };
type Answer = { question: string; option: string | null; note: string };

const HINT_CHOOSE = "↑↓ move · Enter choose · Tab add a note · Esc cancel";
const HINT_NOTE = "Enter accept · Esc back to the options";

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

// Extensions get the same display-aware clipper the transcript uses. Comparing
// its result tells us whether text fits without duplicating terminal-width
// rules here; splitting by grapheme keeps a single long word from vanishing.
const wrap = (g: Glrs, text: string, limit: number): string[] => {
  const fits = (value: string): boolean => g.clip(value, limit) === value;
  const rows: string[] = [];
  let row = "";
  const push = (): void => {
    if (row !== "") rows.push(row);
    row = "";
  };
  const add = (word: string): void => {
    const joined = row === "" ? word : `${row} ${word}`;
    if (fits(joined)) {
      row = joined;
      return;
    }
    push();
    let part = "";
    for (const { segment } of graphemes.segment(word)) {
      if (part !== "" && !fits(`${part}${segment}`)) {
        rows.push(part);
        part = "";
      }
      part += segment;
    }
    row = part;
  };
  for (const paragraph of text.split("\n")) {
    for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) add(word);
    push();
  }
  return rows.length === 0 ? [""] : rows;
};

// The widget, as lines. Everything is `Line[]` — the same span structure the
// transcript uses — so this survives the renderer being replaced.
const draw = (
  g: Glrs,
  state: { items: Question[]; at: number; choice: number; note: string; typing: boolean },
  columns: number,
): Line[] => {
  const current = state.items[state.at];
  const room = Math.max(20, columns - 4);
  const counter = state.items.length > 1 ? `  (${state.at + 1}/${state.items.length})` : "";
  const question = wrap(g, current.question, room - 2);
  const counterFits =
    g.clip(`${question.at(-1)}${counter}`, room - 2) === `${question.at(-1)}${counter}`;
  const lines: Line[] = question.map(
    (text, index): Line => [
      {
        text: index === 0 ? "? " : "  ",
        ...(index === 0 ? { tone: "accent" as const, bold: true } : {}),
      },
      { text, bold: true },
      ...(counter !== "" && index === question.length - 1 && counterFits
        ? [{ text: counter, tone: "muted" as const }]
        : []),
    ],
  );
  if (counter !== "" && !counterFits) lines.push([{ text: `  ${counter.trim()}`, tone: "muted" }]);
  for (const [index, option] of current.options.entries()) {
    const picked = index === state.choice;
    lines.push([
      { text: picked && !state.typing ? "  › " : "    ", tone: "accent" },
      {
        text: g.clip(option, room),
        tone: picked ? "accent" : "highlight",
        bold: picked,
      },
    ]);
  }
  if (state.typing || state.note !== "") {
    lines.push([
      { text: "  note: ", tone: "muted" },
      { text: g.clip(state.note, room - 8) },
      ...(state.typing ? [{ text: "▏", tone: "accent" as const }] : []),
    ]);
  }
  lines.push([{ text: `  ${state.typing ? HINT_NOTE : HINT_CHOOSE}`, tone: "muted" }]);
  return lines;
};

// What the model reads. Prose rather than JSON: the answers are for a language
// model, and the old widget returned a JSON string only because the core needed
// a shape it could parse back out again.
const report = (answers: Answer[]): string =>
  answers
    .map((answer) => {
      const chosen = answer.option ?? "(no option chosen)";
      return `Q: ${answer.question}\nA: ${chosen}${answer.note === "" ? "" : ` — ${answer.note}`}`;
    })
    .join("\n\n");

const askAll = (g: Glrs, items: Question[]): Promise<string> =>
  new Promise((resolve) => {
    const answers: Answer[] = [];
    const state = { items, at: 0, choice: 0, note: "", typing: false };
    let held: { close: () => void; repaint: () => void } | null = null;

    const finish = (text: string): void => {
      held?.close();
      resolve(text);
    };

    const commit = (): void => {
      const current = state.items[state.at];
      answers.push({
        question: current.question,
        option: current.options[state.choice] ?? null,
        note: state.note.trim(),
      });
      if (state.at === state.items.length - 1) {
        finish(report(answers));
        return;
      }
      state.at += 1;
      state.choice = 0;
      state.note = "";
      state.typing = false;
    };

    const onKey = (key: Key): void => {
      const current = state.items[state.at];
      if (key.key === "escape") {
        if (state.typing) {
          state.typing = false;
          return;
        }
        // Dismissing is an answer of a kind, and the model has to be told —
        // silence here reads as a tool that hung.
        finish(
          "The user dismissed the questions without answering. Do not ask again; proceed with your best judgement, or explain what you need.",
        );
        return;
      }
      if (state.typing) {
        if (key.key === "return") {
          state.typing = false;
          commit();
          return;
        }
        if (key.key === "backspace") {
          state.note = state.note.slice(0, -1);
          return;
        }
        // Printable text only. An arrow key arrives as an escape sequence, and
        // appending it would put raw control characters into the note.
        if (key.text !== "" && !/\p{Cc}/u.test(key.text)) state.note += key.text;
        return;
      }
      if (key.key === "up")
        state.choice = (state.choice + current.options.length - 1) % current.options.length;
      else if (key.key === "down") state.choice = (state.choice + 1) % current.options.length;
      else if (key.key === "tab") state.typing = true;
      else if (key.key === "return") commit();
    };

    held = g.ui.capture({ render: (columns) => draw(g, state, columns), onKey });
  });

export default function askUser(g: Glrs): void {
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
    execute: async ({ questions }) => askAll(g, questions),
    // The row says what was asked. A question is the one tool call the user was
    // part of, so naming it is the whole of the row.
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

  // The guidance travels with the tool. It sat in the core prompt, which meant
  // removing the tool left the model instructed to use something that no longer
  // existed.
  g.prompt(
    "Use ask_user when intent, scope, or a material choice is uncertain, and always when you would otherwise offer the user options in prose.",
  );
}
