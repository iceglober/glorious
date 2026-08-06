import type {
  BoxOptions,
  KeyEvent,
  Renderable,
  TextareaRenderable,
  TextChunk,
  TextOptions,
  TextRenderable,
} from "@opentui/core";
import { activeSlash, commandName, commands, matchingCommands } from "./commands";
import { composerKeyBindings, composerWrapMode } from "./composer";
import { clip, type Line, type Span, type Tone, width } from "./render";
import type { Session } from "./session";
import type { SkillSummary } from "./skills";
import type { Question } from "./tools";

const tones: Record<Tone, [string, string]> = {
  accent: ["#67d4e8", "36"],
  highlight: ["#c792ea", "35"],
  muted: ["#8b929c", "2"],
  prompt: ["#d8dee9", "37"],
  success: ["#74d99a", "32"],
  warning: ["#f2c46d", "33"],
  danger: ["#f08080", "31"],
};

const fillHex = "#383f47";
const fatalSignals = ["SIGTERM", "SIGHUP"] as const;
const pastLimit = 100;
const quitMs = 3000;
const quitLine: Line = [{ text: "Ctrl+C again to exit", tone: "warning" }];

export const pickSession = async (sessions: Session[]): Promise<Session> => {
  const tui = await import("@opentui/core");
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
  const picker = new tui.SelectRenderable(renderer, {
    width: "100%",
    height: "100%",
    options: sessions.map((session) => ({
      name: session.title,
      description: `${session.id} · ${session.cwd}`,
      value: session,
    })),
  });
  renderer.root.add(picker);

  return new Promise<Session>((resolve, reject) => {
    let settled = false;
    const finish = (result: Session | Error): void => {
      if (settled) return;
      settled = true;
      picker.off("itemSelected", onSelected);
      renderer.keyInput.off("keypress", onKey);
      renderer.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onSelected = (): void => {
      const selected = picker.getSelectedOption()?.value;
      if (selected) finish(selected as Session);
    };
    const onKey = (event: KeyEvent): void => {
      if (event.name !== "escape") return;
      event.stopPropagation();
      finish(new Error("Session selection cancelled."));
    };
    picker.on("itemSelected", onSelected);
    renderer.keyInput.on("keypress", onKey);
    renderer.start();
    picker.focus();
  });
};

export const createScreen = async (callbacks: {
  promptHistory?: string[];
  onPromptHistory?: (history: string[]) => void;
  onSubmit: (text: string) => void;
  onCommand: (name: string) => void;
  onEscape: () => void;
  onResize: () => void;
  onQuit: () => void;
  sessionId: string;
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
    autoFocus: false,
    consoleMode: "disabled",
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
  });

  const columns = (): number => Math.max(1, renderer.terminalWidth - 1);
  const composerWidth = (): number => Math.max(1, columns() - 4);
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
  const caret = textNode({
    content: styled([[{ text: "› ", tone: "prompt", bold: true }]]),
    bg: fillHex,
  });
  const input = new tui.TextareaRenderable(renderer, {
    placeholder: "Ask Glorious anything",
    keyBindings: [
      ...composerKeyBindings(tui.defaultTextareaKeyBindings),
      { name: "return", action: "submit" },
      { name: "kpenter", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "kpenter", shift: true, action: "newline" },
    ],
    onSubmit: () => submit(),
    wrapMode: composerWrapMode,
    width: composerWidth(),
    backgroundColor: fillHex,
    focusedBackgroundColor: fillHex,
    paddingX: 1,
    paddingTop: 0.5,
    paddingBottom: 0.5,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  });
  const autocompleteLabel = textNode({ content: "", width: "100%", wrapMode: "word" });
  const autocomplete = stack(
    {
      width: composerWidth(),
      height: 1,
      marginTop: 0,
      paddingX: 1,
      backgroundColor: "transparent",
    },
    [autocompleteLabel],
  );

  const composerRow = stack(
    {
      flexDirection: "row",
      width: columns(),
      minWidth: 0,
      marginTop: 1,
      paddingTop: 1,
      paddingX: 1,
      backgroundColor: fillHex,
    },
    [caret, input],
  );

  const footer = stack({ flexDirection: "column", flexShrink: 0, width: "100%" }, [
    progress,
    autocomplete,
    composerRow,
    status,
  ]);
  renderer.root.add(
    stack({ flexDirection: "column", width: "100%", height: "100%" }, [view, footer]),
  );

  const log: Array<{ lines: Line[]; gap: boolean; node: TextRenderable }> = [];
  const past = callbacks.promptHistory?.slice(-pastLimit) ?? [];
  let cursor: number | null = null;
  let phase: "new" | "live" | "done" = "new";
  let statusRows: Line[] = [];
  let quitTimer: ReturnType<typeof setTimeout> | null = null;
  let questionView: Renderable | null = null;
  let questionTitle: TextRenderable | null = null;
  let questionOptionsLabel: TextRenderable | null = null;
  let questionOptions: InstanceType<typeof tui.SelectRenderable> | null = null;
  let questionNoteLabel: TextRenderable | null = null;
  let questionNote: TextareaRenderable | null = null;
  let questionIndex = 0;
  let questionItems: Question[] = [];
  let questionAnswers: Array<{ question: string; option: string | null; note: string }> = [];
  let questionOptionTouched = false;
  let questionResolve: ((result: string) => void) | null = null;
  let questionAbort: (() => void) | null = null;
  let questionCleanup: (() => void) | null = null;
  let questionFocus: "options" | "note" = "options";
  let autocompleteSlash: { start: number; query: string } | null = null;
  let autocompleteItems: ReturnType<typeof matchingCommands> = [];
  let autocompleteIndex = 0;
  let autocompleteOpen = false;
  let helpView: Renderable | null = null;
  let skillsScroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;

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
    paintStatus(quitTimer === null ? statusRows : [quitLine, ...statusRows]);
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

  const syncAutocomplete = (): void => {
    autocompleteSlash = activeSlash(input.plainText, input.cursorOffset);
    const matches = autocompleteSlash ? matchingCommands(autocompleteSlash.query) : [];
    autocompleteItems = matches;
    autocompleteIndex = Math.min(autocompleteIndex, Math.max(0, matches.length - 1));
    autocompleteLabel.content = styled(
      matches.map(
        (command, index): Line => [
          { text: index === autocompleteIndex ? "› " : "  ", tone: "accent" },
          {
            text: `/${command.name}`,
            tone: index === autocompleteIndex ? "accent" : "highlight",
            bold: true,
          },
          { text: `  ${command.description}`, tone: "muted" },
        ],
      ),
    );
    autocompleteOpen = matches.length > 0;
    autocomplete.height = Math.max(1, matches.length);
    autocomplete.marginTop = autocompleteOpen ? 1 : 0;
    autocomplete.backgroundColor = autocompleteOpen ? "#20252b" : "transparent";
    if (matches.length === 0) {
      autocompleteSlash = null;
      autocompleteIndex = 0;
    }
    draw();
  };

  const completeCommand = (): void => {
    const selected = autocompleteItems[autocompleteIndex]?.name;
    if (!selected || !autocompleteSlash) return;
    const text = input.plainText;
    const end = input.cursorOffset;
    compose(`${text.slice(0, autocompleteSlash.start)}/${selected}${text.slice(end)}`);
    input.cursorOffset = autocompleteSlash.start + selected.length + 1;
    syncAutocomplete();
  };

  const closeHelp = (): void => {
    if (!helpView) return;
    renderer.root.remove(helpView);
    helpView.destroy();
    helpView = null;
    skillsScroll = null;
    input.focus();
    draw();
  };

  const showHelp = (): void => {
    if (helpView) return;
    const body = textNode({
      content: styled([
        [{ text: "Slash commands", tone: "accent", bold: true }],
        [{ text: "Type / anywhere after whitespace to open autocomplete." }],
        [{ text: "Use ↑/↓ to move, Tab to complete, and Enter to run." }],
        [{ text: "" }],
        ...commands.map(
          (command): Line => [
            { text: `/${command.name}`, tone: "highlight", bold: true },
            { text: `  ${command.description}` },
          ],
        ),
        [{ text: "" }],
        [{ text: "Esc closes this help", tone: "muted" }],
      ]),
      width: "100%",
      wrapMode: "word",
    });
    helpView = stack(
      {
        position: "absolute",
        top: 2,
        left: 4,
        width: Math.max(1, columns() - 8),
        height: 9,
        paddingX: 2,
        paddingY: 1,
        backgroundColor: "#20252b",
        border: true,
        borderColor: "#4b5563",
        title: " Help ",
        titleColor: "#67d4e8",
        zIndex: 10,
      },
      [body],
    );
    renderer.root.add(helpView);
    input.blur();
    draw();
  };

  const showSkills = (summaries: readonly SkillSummary[]): void => {
    if (helpView) return;
    const modalWidth = Math.min(100, Math.max(1, columns() - 8));
    const contentWidth = Math.max(1, modalWidth - 6);
    const skillLines: Line[] =
      summaries.length === 0
        ? [[{ text: "No skills found.", tone: "muted" }]]
        : summaries.flatMap((skill, index): Line[] => {
            const name = clip(skill.name, contentWidth);
            const description = clip(skill.description, Math.max(1, contentWidth - 2));
            const location = clip(skill.location, Math.max(1, contentWidth - 6));
            return [
              [
                { text: "◆ ", tone: "accent" },
                { text: name, tone: "highlight", bold: true },
              ],
              [{ text: "  " }, { text: description, tone: "muted" }],
              [
                { text: "  ↳ ", tone: "muted" },
                { text: location, tone: "muted", italic: true },
              ],
              ...(index + 1 < summaries.length ? [[{ text: "" }]] : []),
            ];
          });
    const skillRows = Math.max(1, skillLines.length);
    const listHeight = Math.max(1, Math.min(skillRows, renderer.terminalHeight - 10));
    const modalHeight = listHeight + 6;
    const header = textNode({
      content: styled([[{ text: "Available skills", tone: "accent", bold: true }]]),
      width: "100%",
      height: 1,
    });
    skillsScroll = new tui.ScrollBoxRenderable(renderer, {
      width: "100%",
      height: listHeight,
      minHeight: 1,
      scrollY: true,
      stickyScroll: false,
      stickyStart: "top",
      backgroundColor: "#20252b",
      contentOptions: { flexDirection: "column" },
    });
    skillsScroll.add(textNode({ content: styled(skillLines), width: "100%", wrapMode: "none" }));
    const footer = textNode({
      content: "↑/↓ scroll · Esc closes this list",
      width: "100%",
      height: 1,
      fg: "#8b929c",
    });
    helpView = stack(
      {
        position: "absolute",
        top: Math.max(0, Math.floor((renderer.terminalHeight - modalHeight) / 2)),
        left: Math.max(0, Math.floor((columns() - modalWidth) / 2)),
        width: modalWidth,
        height: modalHeight,
        paddingX: 2,
        paddingY: 1,
        backgroundColor: "#20252b",
        border: true,
        borderColor: "#4b5563",
        title: " Skills ",
        titleColor: "#67d4e8",
        zIndex: 10,
      },
      [header, skillsScroll, footer],
    );
    renderer.root.add(helpView);
    input.blur();
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
    const selected = autocompleteItems[autocompleteIndex]?.name;
    if (autocompleteOpen && autocompleteSlash && autocompleteSlash.query !== selected) {
      completeCommand();
      return;
    }
    if (text.trim() === "") return;
    const name = commandName(text);
    if (name) {
      autocompleteOpen = false;
      autocompleteItems = [];
      autocompleteSlash = null;
      compose("");
      callbacks.onCommand(name);
      return;
    }
    if (past.at(-1) !== text) past.push(text);
    past.splice(0, past.length - pastLimit);
    callbacks.onPromptHistory?.(past.slice());
    cursor = null;
    compose("");
    callbacks.onSubmit(text);
  };

  const closeQuestionView = (): void => {
    if (questionView) {
      renderer.root.remove(questionView);
      questionView.destroy();
    }
    questionView = null;
    questionTitle = null;
    questionOptionsLabel = null;
    questionOptions = null;
    questionNoteLabel = null;
    questionNote = null;
    questionItems = [];
    questionAnswers = [];
    questionIndex = 0;
    input.focus();
    draw();
  };

  const finishQuestions = (result: string): void => {
    const resolve = questionResolve;
    questionResolve = null;
    questionAbort = null;
    questionCleanup?.();
    questionCleanup = null;
    closeQuestionView();
    resolve?.(result);
  };

  const renderQuestion = (): void => {
    const current = questionItems[questionIndex];
    if (!current || !questionTitle || !questionOptions || !questionNote) return;
    const contentWidth = Math.max(1, columns() - 4);
    const questionText = current.question.replaceAll("\n", " ");
    const questionLines = Math.max(1, Math.ceil(width(questionText) / contentWidth));
    questionTitle.height = questionLines + 1;
    questionTitle.content = styled([
      [
        {
          text: `? Question ${questionIndex + 1}/${questionItems.length}`,
          tone: "accent",
          bold: true,
        },
      ],
      [{ text: questionText, bold: true }],
    ]);
    if (questionView) {
      questionView.height = questionLines + current.options.length + 11;
    }
    questionOptions.height = current.options.length;
    questionOptions.options = current.options.map((option) => ({
      name: option,
      description: "",
      value: option,
    }));
    questionNote.setText("");
    questionOptionTouched = false;
    questionFocus = "options";
    questionOptions.focus();
    draw();
  };

  const submitQuestion = (): void => {
    if (!questionOptions || !questionNote) return;
    const current = questionItems[questionIndex];
    const selected = questionOptions.getSelectedOption()?.value;
    const note = questionNote.plainText.trim();
    const option =
      questionOptionTouched || note === ""
        ? typeof selected === "string"
          ? selected
          : null
        : null;
    if (!current || (option === null && note === "")) return;
    questionAnswers.push({ question: current.question, option, note });
    if (questionIndex + 1 < questionItems.length) {
      questionIndex += 1;
      renderQuestion();
      return;
    }
    finishQuestions(JSON.stringify({ answers: questionAnswers }));
  };

  const askQuestions = (questions: Question[], signal: AbortSignal | undefined): Promise<string> =>
    new Promise((resolve) => {
      questionItems = questions;
      questionAnswers = [];
      questionIndex = 0;
      questionResolve = resolve;
      questionAbort = () => finishQuestions(JSON.stringify({ cancelled: true }));
      questionTitle = textNode({ content: "", width: "100%", wrapMode: "word" });
      questionOptionsLabel = textNode({
        content: "OPTIONS · choose one",
        width: "100%",
        height: 1,
        fg: "#8b929c",
      });
      questionOptions = new tui.SelectRenderable(renderer, {
        width: "100%",
        height: 1,
        backgroundColor: fillHex,
        focusedBackgroundColor: fillHex,
        selectedBackgroundColor: "#4b5563",
        selectedTextColor: "#ffffff",
        showDescription: false,
        itemSpacing: 0,
      });
      questionOptions.on("selectionChanged", () => {
        questionOptionTouched = true;
      });
      questionNoteLabel = textNode({
        content: "NOTE · optional",
        width: "100%",
        height: 1,
        fg: "#8b929c",
      });
      questionNote = new tui.TextareaRenderable(renderer, {
        placeholder: "Add context or replace the selection",
        width: "100%",
        height: 3,
        wrapMode: "word",
        backgroundColor: fillHex,
        focusedBackgroundColor: fillHex,
        paddingX: 1,
        keyBindings: [
          ...composerKeyBindings(tui.defaultTextareaKeyBindings),
          { name: "return", action: "submit" },
          { name: "kpenter", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "kpenter", shift: true, action: "newline" },
        ],
        onSubmit: submitQuestion,
      });
      const help = textNode({
        content: "Tab note · Enter next · Esc cancel",
        width: "100%",
        height: 1,
        fg: "#8b929c",
      });
      questionView = stack(
        {
          flexDirection: "column",
          width: "100%",
          height: 1,
          paddingX: 2,
          paddingY: 1,
          rowGap: 0,
          backgroundColor: "#20252b",
          border: true,
          borderColor: "#4b5563",
          title: " Questions ",
          titleColor: "#67d4e8",
        },
        [
          questionTitle,
          questionOptionsLabel,
          questionOptions,
          questionNoteLabel,
          questionNote,
          help,
        ],
      );
      renderer.root.add(questionView);
      const cancel = (): void => questionAbort?.();
      signal?.addEventListener("abort", cancel, { once: true });
      questionCleanup = () => signal?.removeEventListener("abort", cancel);
      renderQuestion();
    });

  const onCtrlC = (): void => {
    const armed = disarm();
    if (input.plainText !== "") {
      compose("");
      syncAutocomplete();
    } else if (armed) callbacks.onQuit();
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
    if (helpView) {
      if (event.name === "escape" || (event.ctrl && event.name === "c")) {
        event.stopPropagation();
        closeHelp();
      } else if (skillsScroll && event.name === "up") {
        event.stopPropagation();
        skillsScroll.scrollTop = Math.max(0, skillsScroll.scrollTop - 1);
        draw();
      } else if (skillsScroll && event.name === "down") {
        event.stopPropagation();
        skillsScroll.scrollTop += 1;
        draw();
      }
      return;
    }
    if (questionView) {
      if (event.ctrl && event.name === "c") {
        event.stopPropagation();
        questionAbort?.();
      } else if (event.name === "escape") {
        event.stopPropagation();
        questionAbort?.();
      } else if (event.name === "tab") {
        event.stopPropagation();
        questionFocus = questionFocus === "options" ? "note" : "options";
        if (questionFocus === "options") questionOptions?.focus();
        else questionNote?.focus();
      } else if (
        questionFocus === "options" &&
        (event.name === "return" || event.name === "kpenter")
      ) {
        event.stopPropagation();
        submitQuestion();
      }
      return;
    }
    if (autocompleteOpen) {
      if (event.name === "up") {
        event.stopPropagation();
        autocompleteIndex =
          (autocompleteIndex + autocompleteItems.length - 1) % autocompleteItems.length;
        syncAutocomplete();
        return;
      }
      if (event.name === "down") {
        event.stopPropagation();
        autocompleteIndex = (autocompleteIndex + 1) % autocompleteItems.length;
        syncAutocomplete();
        return;
      }
      if (event.name === "tab") {
        event.stopPropagation();
        completeCommand();
        return;
      }
      if (event.name === "escape") {
        event.stopPropagation();
        autocompleteOpen = false;
        autocompleteItems = [];
        autocompleteSlash = null;
        draw();
        return;
      }
    }
    const back = (!event.shift && event.name === "up") || (event.ctrl && event.name === "p");
    const forward = (!event.shift && event.name === "down") || (event.ctrl && event.name === "n");
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
    queueMicrotask(syncAutocomplete);
  };

  const onResize = (): void => {
    composerRow.width = columns();
    autocomplete.width = composerWidth();
    input.width = composerWidth();
    for (const block of log) block.node.content = styled(block.lines);
    callbacks.onResize();
    draw();
  };

  const onSelect = (pick: { getSelectedText: () => string }): void => {
    const picked = pick.getSelectedText();
    if (picked.length > 0) renderer.copyToClipboardOSC52(picked);
  };

  const stop = (): void => {
    if (phase !== "live") return;
    phase = "done";
    disarm();
    renderer.keyInput.off("keypress", onKey);
    renderer.off("resize", onResize);
    renderer.off("selection", onSelect);
    closeHelp();
    for (const signal of fatalSignals) process.off(signal, raise);
    renderer.destroy();
    process.stdout.write(
      `\u001b[2J\u001b[HContinue with: glorious --resume ${callbacks.sessionId}\n`,
    );
  };

  const raise = (signal: NodeJS.Signals): void => {
    stop();
    process.kill(process.pid, signal);
  };

  return {
    start: () => {
      if (phase !== "new") return;
      phase = "live";
      renderer.keyInput.on("keypress", onKey);
      renderer.on("resize", onResize);
      renderer.on("selection", onSelect);
      for (const signal of fatalSignals) process.once(signal, raise);
      renderer.start();
      input.focus();
      syncAutocomplete();
      renderer.requestRender();
    },
    stop,
    print: (lines: Line[], gap: boolean) => {
      const spaced = gap && log.length > 0;
      if (spaced) view.add(textNode({ content: "", width: "100%", height: 1 }));
      const node = textNode({
        content: styled(lines),
        wrapMode: "word",
        width: "100%",
        bg: lines.some((line) => line.some((span) => span.fill)) ? fillHex : undefined,
      });
      view.add(node);
      log.push({ lines, gap: spaced, node });
      draw();
    },
    setProgress: painter(progress),
    setStatus: (lines: Line[]) => {
      statusRows = lines;
      showStatus();
    },
    restoreInput: (text: string) => {
      const draft = input.plainText;
      cursor = null;
      compose(draft === "" ? text : `${text}\n\n${draft}`);
      input.cursorOffset = text.length;
    },
    columns,
    showHelp,
    showSkills,
    askQuestions,
  };
};
