import type { BoxOptions, Renderable, TextChunk, TextOptions } from "@opentui/core";
import { type Line, type Span, type Tone, width } from "../render";

export type Tui = typeof import("@opentui/core");
export type Renderer = Awaited<ReturnType<Tui["createCliRenderer"]>>;

// One colour per tone. Each was a [hex, ANSI-SGR] pair, and the second half was
// read by nothing — residue of an ANSI renderer that no longer exists. Anything
// still reaching for an SGR code would have been drawing against a renderer
// that paints with RGBA.
export const tones: Record<Tone, string> = {
  accent: "#67d4e8",
  highlight: "#c792ea",
  muted: "#8b929c",
  prompt: "#d8dee9",
  success: "#74d99a",
  warning: "#f2c46d",
  danger: "#f08080",
};

export const fillHex = "#383f47";
export const panelHex = "#20252b";

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
  // The terminal's height, for anything that has to decide how many rows it may
  // take. A panel sized without asking simply gets clipped, and the rows it
  // thinks it drew are rows nobody can see.
  const rows = (): number => Math.max(1, renderer.terminalHeight);

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
    if (span.tone) piece.fg = tui.RGBA.fromHex(tones[span.tone]);
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
    rows,
    textNode: (options: TextOptions) => new tui.TextRenderable(renderer, options),
    stack,
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
