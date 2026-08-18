import type { Glorious, Key, Line } from "@glrs-dev/glorious-core";

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
    execute: async ({ questions }) => {
      let question = 0;
      let option = 0;
      let resolveAnswer: ((answer: string) => void) | undefined;
      let capture: { close: () => void; repaint: () => void } | undefined;
      const answer = new Promise<string>((resolve) => {
        resolveAnswer = resolve;
        capture = g.ui.capture({
          render: (columns): Line[] => {
            const current = questions[question];
            if (!current) return [];
            const lines: Line[] = [[{ text: current.question, tone: "accent", bold: true }]];
            for (const [index, choice] of current.options.entries())
              lines.push([
                { text: index === option ? "› " : "  ", tone: "accent" },
                { text: choice, tone: index === option ? "highlight" : "muted" },
              ]);
            lines.push([
              {
                text: `${question + 1}/${questions.length} · ↑↓ choose · Enter select · Esc cancel`,
                tone: "muted",
              },
            ]);
            return lines.map((line) =>
              line.map((span) => ({ ...span, text: span.text.slice(0, columns) })),
            );
          },
          onKey: (key: Key) => {
            const current = questions[question];
            if (!current) return;
            if (key.key === "up")
              option = (option + current.options.length - 1) % current.options.length;
            if (key.key === "down") option = (option + 1) % current.options.length;
            if (key.key === "return") {
              if (question + 1 < questions.length) {
                question += 1;
                option = 0;
              } else {
                resolveAnswer?.(
                  JSON.stringify({
                    answers: questions.map((item, index) => ({
                      question: item.question,
                      option: item.options[index === question ? option : 0],
                    })),
                  }),
                );
                capture?.close();
              }
            }
            if (key.key === "escape") {
              resolveAnswer?.(JSON.stringify({ cancelled: true }));
              capture?.close();
            }
            capture?.repaint();
          },
        });
      });
      return answer;
    },
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

  g.prompt(
    "Use ask_user when intent, scope, or a material choice is uncertain, and always when you would otherwise offer the user options in prose.",
  );
}
