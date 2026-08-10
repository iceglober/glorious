import type { BoxOptions, Renderable, TextChunk, TextOptions } from "@opentui/core";
import { type Line, type Span, type Tone, width } from "../render";

export type Tui = typeof import("@opentui/core");
export type Renderer = Awaited<ReturnType<Tui["createCliRenderer"]>>;

export const tones: Record<Tone, [string, string]> = {
  accent: ["#67d4e8", "36"],
  highlight: ["#c792ea", "35"],
  muted: ["#8b929c", "2"],
  prompt: ["#d8dee9", "37"],
  success: ["#74d99a", "32"],
  warning: ["#f2c46d", "33"],
  danger: ["#f08080", "31"],
};

export const fillHex = "#383f47";
export const panelHex = "#20252b";
export const edgeHex = "#4b5563";
export const dimHex = "#8b929c";
export const accentHex = tones.accent[0];

// a list sits between a header and a key legend, each with a blank row of its own
export const listChrome = 4;
// title row + the row of top padding that separates it from the transcript
const sheetChrome = 2;
// A sheet takes over the composer rather than covering the transcript, and it
// spends no rows on a border, so it can afford more of the viewport than the
// centered modal it replaced (which took three eighths).
const sheetShare = 1 / 2;

export const sheetHeight = (contentRows: number): number => contentRows + sheetChrome;

export type Chrome = ReturnType<typeof createChrome>;

export type Host = {
  draw: () => void;
  focusComposer: () => void;
  blurComposer: () => void;
  // Put a node where the composer sits, or restore the composer with null. An
  // ask_user question belongs in the input area, not in a panel over the top of
  // it — the user is being asked to answer, not interrupted.
  useComposerSlot: (node: Renderable | null) => void;
};

export const createChrome = (tui: Tui, renderer: Renderer) => {
  const colored = process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
  const columns = (): number => Math.max(1, renderer.terminalWidth - 1);

  const spread = (line: Line): Span[] => {
    const shown = line.filter((span) => span.text !== "");
    if (!shown.some((span) => span.fill)) return shown;
    const room = columns() - shown.reduce((sum, span) => sum + width(span.text), 0);
    return room > 0 ? [...shown, { text: "\u00a0".repeat(room), fill: true }] : shown;
  };

  const chunk = (span: Span): TextChunk => {
    const text = span.text.replaceAll("\n", " ");
    if (!colored) return { __isChunk: true, text, attributes: 0 };
    let bits = 0;
    if (span.bold) bits |= tui.TextAttributes.BOLD;
    if (span.italic) bits |= tui.TextAttributes.ITALIC;
    if (span.underline) bits |= tui.TextAttributes.UNDERLINE;
    const piece: TextChunk = { __isChunk: true, text, attributes: bits };
    if (span.tone) piece.fg = tui.RGBA.fromHex(tones[span.tone][0]);
    if (span.fill) piece.bg = tui.RGBA.fromHex(fillHex);
    return piece;
  };

  const stack = (options: BoxOptions, kids: Renderable[]) => {
    const parent = new tui.BoxRenderable(renderer, options);
    for (const kid of kids) parent.add(kid);
    return parent;
  };

  return {
    tui,
    renderer,
    columns,
    textNode: (options: TextOptions) => new tui.TextRenderable(renderer, options),
    stack,
    sheetRows: (): number =>
      Math.max(3, Math.round(renderer.terminalHeight * sheetShare) - sheetChrome),
    // A menu rendered where the composer sits. No border and no centering: it is
    // the input area in a different state, not something laid over the session.
    sheet: (options: { title: string; height: number }, kids: Renderable[]) => {
      const title = new tui.TextRenderable(renderer, {
        content: new tui.StyledText([
          {
            __isChunk: true,
            text: options.title,
            attributes: tui.TextAttributes.BOLD,
            fg: tui.RGBA.fromHex(accentHex),
          },
        ]),
        width: "100%",
        height: 1,
      });
      return stack(
        {
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          height: Math.max(3, Math.min(options.height, renderer.terminalHeight - 2)),
          paddingTop: 1,
          paddingX: 1,
          backgroundColor: fillHex,
        },
        [title, ...kids],
      );
    },
    styled: (lines: readonly Line[]) =>
      new tui.StyledText(
        lines.flatMap((line, at) => {
          const pieces = spread(line).map(chunk);
          if (at === 0) return pieces;
          return [{ __isChunk: true, text: "\n" } as TextChunk, ...pieces];
        }),
      ),
  };
};
