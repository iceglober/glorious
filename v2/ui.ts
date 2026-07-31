import type {
  BoxOptions,
  KeyEvent,
  Renderable,
  TextChunk,
  TextOptions,
  TextRenderable,
} from "@opentui/core";
import { type Line, type Span, type Tone, width } from "./render";

const tones: Record<Tone, [string, string]> = {
  accent: ["#67d4e8", "36"],
  muted: ["#8b929c", "2"],
  success: ["#74d99a", "32"],
  warning: ["#f2c46d", "33"],
  danger: ["#f08080", "31"],
};

const fillHex = "#383f47";
const enterKeys = new Set(["return", "kpenter", "linefeed"]);
const fatalSignals = ["SIGTERM", "SIGHUP"] as const;
const pastLimit = 100;
const quitMs = 3000;
const quitLine: Line = [{ text: "Ctrl+C again to exit", tone: "warning" }];

export const createScreen = async (callbacks: {
  onSubmit: (text: string) => void;
  onEscape: () => void;
  onResize: () => void;
  onQuit: () => void;
}) => {
  const tui = await import("@opentui/core");
  const colored = process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
  const renderer = await tui.createCliRenderer({
    stdin: process.stdin,
    stdout: process.stdout,
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: true,
    consoleMode: "disabled",
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
  });

  const columns = (): number => Math.max(1, renderer.terminalWidth - 1);
  const textNode = (options: TextOptions) => new tui.TextRenderable(renderer, options);

  const stack = (options: BoxOptions, kids: Renderable[]) => {
    const parent = new tui.BoxRenderable(renderer, options);
    for (const kid of kids) parent.add(kid);
    return parent;
  };

  const spread = (line: Line): Span[] => {
    const shown = line.filter((span) => span.text !== "");
    if (!shown.some((span) => span.fill)) return shown;
    const room = columns() - shown.reduce((sum, span) => sum + width(span.text), 0);
    return room > 0 ? [...shown, { text: " ".repeat(room), fill: true }] : shown;
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

  const styled = (lines: readonly Line[]) =>
    new tui.StyledText(
      lines.flatMap((line, at) => {
        const pieces = spread(line).map(chunk);
        if (at === 0) return pieces;
        return [{ __isChunk: true, text: "\n" } as TextChunk, ...pieces];
      }),
    );

  const view = new tui.ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    contentOptions: { justifyContent: "flex-end" },
  });
  const progress = textNode({ content: "", wrapMode: "word", width: "100%" });
  const status = textNode({ content: "", wrapMode: "word", width: "100%" });
  const caret = textNode({ content: styled([[{ text: "› ", tone: "accent", bold: true }]]) });
  const input = new tui.TextareaRenderable(renderer, {
    placeholder: "Ask Glorious anything",
    keyBindings: [
      ...tui.defaultTextareaKeyBindings.filter((k) => k.shift || !enterKeys.has(k.name)),
      { name: "return", action: "submit" },
      { name: "kpenter", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "kpenter", shift: true, action: "newline" },
    ],
    onSubmit: () => submit(),
    wrapMode: "word",
    flexGrow: 1,
  });
  const footer = stack({ flexDirection: "column", flexShrink: 0, width: "100%" }, [
    progress,
    stack({ flexDirection: "row", width: "100%" }, [caret, input]),
    status,
  ]);
  renderer.root.add(
    stack({ flexDirection: "column", width: "100%", height: "100%" }, [view, footer]),
  );

  const log: Array<{ lines: Line[]; gap: boolean; node: TextRenderable }> = [];
  const past: string[] = [];
  let cursor: number | null = null;
  let phase: "new" | "live" | "done" = "new";
  let statusRow: Line = [];
  let quitTimer: ReturnType<typeof setTimeout> | null = null;

  const draw = (): void => {
    if (phase === "live") renderer.requestRender();
  };

  const painter = (node: TextRenderable) => {
    let shown = "";
    return (lines: Line[]): void => {
      const key = JSON.stringify(lines);
      if (key === shown) return;
      shown = key;
      node.content = styled(lines);
      node.visible = lines.length > 0;
      draw();
    };
  };

  const paintStatus = painter(status);
  const showStatus = (): void => {
    paintStatus(quitTimer === null ? [statusRow] : [quitLine, statusRow]);
  };

  const disarm = (): boolean => {
    if (quitTimer === null) return false;
    clearTimeout(quitTimer);
    quitTimer = null;
    return true;
  };

  const compose = (text: string): void => {
    input.setText(text);
    input.cursorOffset = text.length;
    draw();
  };

  const recall = (step: -1 | 1): boolean => {
    const next = Math.min(past.length, Math.max(0, (cursor ?? past.length) + step));
    if (next === past.length && cursor === null) return false;
    compose(past[next] ?? "");
    cursor = next === past.length ? null : next;
    return true;
  };

  const submit = (): void => {
    const text = input.plainText;
    if (text.trim() === "") return;
    if (past.at(-1) !== text) past.push(text);
    past.splice(0, past.length - pastLimit);
    cursor = null;
    compose("");
    callbacks.onSubmit(text);
  };

  const onCtrlC = (): void => {
    const armed = disarm();
    if (input.plainText !== "") compose("");
    else if (armed) callbacks.onQuit();
    else {
      quitTimer = setTimeout(() => {
        quitTimer = null;
        showStatus();
      }, quitMs);
      callbacks.onEscape();
    }
    showStatus();
  };

  const onKey = (event: KeyEvent): void => {
    if (phase !== "live") return;
    const back = event.name === "up" || (event.ctrl && event.name === "p");
    const forward = event.name === "down" || (event.ctrl && event.name === "n");
    if (!back && !forward) cursor = null;
    if (event.ctrl && event.name === "c") {
      event.stopPropagation();
      onCtrlC();
      return;
    }
    if (disarm()) showStatus();
    if (event.name === "escape") {
      event.stopPropagation();
      callbacks.onEscape();
      return;
    }
    if ((back && recall(-1)) || (forward && recall(1))) event.stopPropagation();
  };

  const onResize = (): void => {
    for (const block of log) block.node.content = styled(block.lines);
    callbacks.onResize();
    draw();
  };

  const onSelect = (pick: { getSelectedText: () => string }): void => {
    const picked = pick.getSelectedText();
    if (picked.length > 0) renderer.copyToClipboardOSC52(picked);
  };

  const raise = (signal: NodeJS.Signals): void => {
    if (phase !== "done") {
      phase = "done";
      try {
        renderer.destroy();
      } catch {}
    }
    process.kill(process.pid, signal);
  };

  const ansi = (span: Span): string => {
    const text = span.text.replaceAll("\n", " ");
    const on: string[] = [];
    if (span.tone) on.push(tones[span.tone][1]);
    if (span.bold) on.push("1");
    if (span.italic) on.push("3");
    if (span.underline) on.push("4");
    if (span.fill) on.push("100");
    return !colored || on.length === 0 ? text : `\u001b[${on.join(";")}m${text}\u001b[0m`;
  };

  return {
    start: () => {
      if (phase !== "new") return;
      phase = "live";
      renderer.keyInput.on("keypress", onKey);
      renderer.on("resize", onResize);
      renderer.on("selection", onSelect);
      for (const signal of fatalSignals) process.once(signal, raise);
      input.focus();
      renderer.start();
      renderer.requestRender();
    },
    stop: () => {
      if (phase !== "live") return;
      phase = "done";
      disarm();
      renderer.keyInput.off("keypress", onKey);
      renderer.off("resize", onResize);
      renderer.off("selection", onSelect);
      for (const signal of fatalSignals) process.off(signal, raise);
      renderer.destroy();
      const dump = log
        .map((block) => {
          const body = block.lines.map((line) => spread(line).map(ansi).join("")).join("\n");
          return `${block.gap ? "\n" : ""}${body}\n`;
        })
        .join("");
      if (dump.length > 0) process.stdout.write(dump);
    },
    print: (lines: Line[], gap: boolean) => {
      const spaced = gap && log.length > 0;
      if (spaced) view.add(textNode({ content: "", width: "100%", height: 1 }));
      const node = textNode({ content: styled(lines), wrapMode: "word", width: "100%" });
      view.add(node);
      log.push({ lines, gap: spaced, node });
      draw();
    },
    setProgress: painter(progress),
    setStatus: (line: Line) => {
      statusRow = line;
      showStatus();
    },
    restoreInput: (text: string) => {
      const draft = input.plainText;
      cursor = null;
      compose(draft === "" ? text : `${text}\n\n${draft}`);
      input.cursorOffset = text.length;
    },
    columns,
  };
};
