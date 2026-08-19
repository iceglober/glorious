import type { KeyEvent, Renderable, TextRenderable } from "@opentui/core";
import { activeSigil, commandInvocation, matchingCommands } from "../commands";
import {
  atFirstLine,
  atLastLine,
  completionWindow,
  composerKeyBindings,
  composerWrapMode,
  enterKeys,
  isAlt,
} from "../composer";
import type { Capture } from "../extension-api";
import type { QueueKind } from "../queue";
import type { Line } from "../render";
import { createChrome, fillHex, panelHex } from "./chrome";

const fatalSignals = ["SIGTERM", "SIGHUP"] as const;
const pastLimit = 100;
const quitMs = 3000;
const quitLine: Line = [{ text: "Ctrl+C again to exit", tone: "warning" }];

export const createScreen = async (callbacks: {
  promptHistory?: string[];
  onPromptHistory?: (history: string[]) => void;
  // `kind` is which queue the message joins when the agent is busy: Enter
  // sends a follow-up, Alt+Enter a steering message. With nothing running they
  // are the same thing — a turn — which is why the composer does not care
  // whether the agent is working and never has to be told.
  onSubmit: (text: string, kind: QueueKind) => void;
  // Alt+Up: hand the newest waiting message back to the composer.
  onUnqueue: () => void;
  onShell: (command: string) => void;
  cwd: string;
  onCommand: (name: string, args: string) => void;
  onFileSearch: (query: string) => Promise<readonly string[]>;
  onKeyBinding?: (event: KeyEvent) => boolean;
  onEscape: () => void;
  onResize: () => void;
  onQuit: () => void;
  sessionId: string;
}) => {
  const tui = await import("@opentui/core");
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

  const chrome = createChrome(tui, renderer);
  const { columns, textNode, stack, styled } = chrome;
  const composerWidth = (): number => Math.max(1, columns() - 4);

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
  // Extension-drawn rows. They sit under the composer beside the status line
  // rather than above it, so nothing an extension draws can push the thing you
  // are typing around.
  const extra = textNode({ content: "", wrapMode: "word", width: "100%" });
  const status = textNode({ content: "", wrapMode: "word", width: "100%" });
  const waterline = textNode({ content: "", width: "100%", height: 1 });
  const caret = textNode({
    content: styled([[{ text: "› ", tone: "prompt", bold: true }]]),
    bg: fillHex,
    wrapMode: "none",
    height: 1,
    flexShrink: 0,
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
    onSubmit: () => submit("follow-up"),
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
      marginTop: 0,
      paddingTop: 1,
      paddingX: 1,
      backgroundColor: fillHex,
    },
    [caret, input],
  );

  const composerSlot = stack(
    { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
    [composerRow],
  );
  const footer = stack({ flexDirection: "column", flexShrink: 0, width: "100%" }, [
    progress,
    autocomplete,
    waterline,
    composerSlot,
    extra,
    status,
  ]);
  renderer.root.add(
    stack({ flexDirection: "column", width: "100%", height: "100%" }, [view, footer]),
  );

  const log: Array<{ lines: Line[]; node: TextRenderable; block: Renderable }> = [];
  const past = callbacks.promptHistory?.slice(-pastLimit) ?? [];
  let cursor: number | null = null;
  let phase: "new" | "live" | "done" = "new";
  let statusRows: Line[] = [];
  let quitTimer: ReturnType<typeof setTimeout> | null = null;
  // How many completion rows are on screen at once — at most this, and never
  // more than the terminal can actually show. It was a flat 10: on a short
  // terminal the window was larger than the space for it, so the last rows were
  // clipped and moving the selection into them looked like a list that refused
  // to scroll. The reserve is the composer, the status line and a little air.
  const AUTOCOMPLETE_MAX = 10;
  const AUTOCOMPLETE_RESERVE = 8;
  const autocompleteRows = (): number =>
    Math.max(1, Math.min(AUTOCOMPLETE_MAX, chrome.rows() - AUTOCOMPLETE_RESERVE));
  let autocompleteSigil: { sigil: string; start: number; query: string } | null = null;
  let autocompleteItems: readonly { name: string; description: string }[] = [];
  let autocompleteIndex = 0;
  let autocompleteOpen = false;
  // the composer text Esc was pressed on, so the menu stays shut until it changes
  let dismissedAt: string | null = null;
  let fileMatches: readonly { name: string; description: string }[] = [];
  let fileQuery: string | null = null;
  const refreshFiles = async (query: string): Promise<void> => {
    if (query === fileQuery) return;
    fileQuery = query;
    const found = await callbacks.onFileSearch(query);
    if (fileQuery !== query) return;
    fileMatches = found.map((path) => ({ name: path, description: "" }));
    syncAutocomplete();
  };
  let shellMode = false;
  // index into `log` of the block still being streamed into, if any
  let drafting: number | null = null;

  const printBlock = (lines: Line[], gap: boolean): void => {
    const spaced = gap && log.length > 0;
    if (spaced) view.add(textNode({ content: "", width: "100%", height: 1 }));
    const filled = lines.some((line) => line.some((span) => span.fill));
    const node = textNode({
      content: styled(lines),
      wrapMode: "word",
      width: columns(),
      bg: filled ? fillHex : undefined,
    });
    const block = filled
      ? stack({ width: columns(), flexShrink: 0, backgroundColor: fillHex }, [node])
      : node;
    view.add(block);
    log.push({ lines, node, block });
    draw();
  };

  const draw = (): void => {
    if (phase === "live") renderer.requestRender();
  };

  let slotted: Renderable | null = null;
  const host = {
    draw,
    focusComposer: () => input.focus(),
    blurComposer: () => input.blur(),
    useComposerSlot: (node: Renderable | null) => {
      if (slotted) composerSlot.remove(slotted);
      slotted = node;
      if (node) composerSlot.add(node);
      composerRow.visible = node === null;
    },
  };
  // Taking over the composer area is the whole of glorious's input primitive.
  // A question widget used to live here — 234 lines of renderer code, for the
  // sake of one tool — which meant the core had an opinion about what asking
  // looks like. This draws whatever lines it is handed and gives away every key
  // until it closes; a picker, a form, a confirmation are all somebody else's.
  let captured: Capture | null = null;
  const captureNode = textNode({ content: "", width: "100%", wrapMode: "word" });

  const paintCapture = (): void => {
    if (!captured) return;
    captureNode.content = styled(captured.render(columns()));
    draw();
  };

  const capture = (spec: Capture): { close: () => void; repaint: () => void } => {
    captured = spec;
    host.useComposerSlot(captureNode);
    input.blur();
    paintCapture();
    return {
      // Idempotent, and only the holder can close: a second call, or a call
      // from something that has since been replaced, must not steal the
      // composer back from whoever holds it now.
      close: (): void => {
        if (captured !== spec) return;
        captured = null;
        host.useComposerSlot(null);
        host.focusComposer();
        draw();
      },
      repaint: paintCapture,
    };
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
  const paintActivity = painter(waterline);
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

  const syncShellMode = (): void => {
    if (!shellMode && input.plainText.startsWith("!")) {
      shellMode = true;
      input.setText(input.plainText.slice(1));
      input.cursorOffset = Math.max(0, input.cursorOffset - 1);
    }
    caret.content = styled([
      [
        {
          text: shellMode ? `${callbacks.cwd} $ ` : "› ",
          tone: shellMode ? "warning" : "prompt",
          bold: true,
        },
      ],
    ]);
    input.placeholder = shellMode ? "Run shell command" : "Ask Glorious anything";
    draw();
  };

  const syncAutocomplete = (): void => {
    if (dismissedAt !== null) {
      if (input.plainText === dismissedAt) return;
      dismissedAt = null;
    }
    // `$` is withheld in shell mode: there every `$VAR` is a real variable, and
    // offering to complete it would fight what is being typed.
    autocompleteSigil = activeSigil(
      input.plainText,
      input.cursorOffset,
      shellMode ? ["/"] : ["/", "@"],
    );
    const matches =
      autocompleteSigil === null
        ? []
        : autocompleteSigil.sigil === "@"
          ? // Files are found on disk, so the list arrives after the keystroke
            // that asked for it; whatever the last lookup returned is shown.
            fileMatches
          : matchingCommands(autocompleteSigil.query);
    if (autocompleteSigil?.sigil === "@") void refreshFiles(autocompleteSigil.query);
    const sigil = autocompleteSigil?.sigil ?? "/";
    autocompleteItems = matches;
    autocompleteIndex = Math.min(autocompleteIndex, Math.max(0, matches.length - 1));
    // The list used to paint every match and size the panel to fit, which was
    // only ever tolerable because the file search capped itself at 8. It shows
    // a window now, scrolled to keep the selection inside it, so a query with
    // sixty matches is sixty matches you can actually reach.
    const { first, count, above, below } = completionWindow(
      matches.length,
      autocompleteIndex,
      autocompleteRows(),
    );
    const shown = matches.slice(first, first + count);
    autocompleteLabel.content = styled([
      ...shown.map((item, offset): Line => {
        const index = first + offset;
        return [
          { text: index === autocompleteIndex ? "› " : "  ", tone: "accent" },
          {
            text: `${sigil}${item.name}`,
            tone: index === autocompleteIndex ? "accent" : "highlight",
            bold: true,
          },
          { text: `  ${item.description}`, tone: "muted" },
        ];
      }),
      // Without this the list looked complete at whatever it happened to show,
      // so there was no reason to press down.
      ...(above > 0 || below > 0
        ? [
            [
              {
                text: `  ${above > 0 ? `↑ ${above} above` : ""}${above > 0 && below > 0 ? " · " : ""}${below > 0 ? `↓ ${below} more` : ""}`,
                tone: "muted" as const,
              },
            ] as Line,
          ]
        : []),
    ]);
    autocompleteOpen = matches.length > 0;
    autocomplete.height = Math.max(1, count + (above > 0 || below > 0 ? 1 : 0));
    autocomplete.marginTop = autocompleteOpen ? 1 : 0;
    autocomplete.backgroundColor = autocompleteOpen ? panelHex : "transparent";
    if (matches.length === 0) {
      autocompleteSigil = null;
      autocompleteIndex = 0;
    }
    draw();
  };

  const completeCommand = (): void => {
    const selected = autocompleteItems[autocompleteIndex]?.name;
    if (!selected || !autocompleteSigil) return;
    const { sigil, start } = autocompleteSigil;
    const text = input.plainText;
    const end = input.cursorOffset;
    compose(`${text.slice(0, start)}${sigil}${selected}${text.slice(end)}`);
    input.cursorOffset = start + selected.length + sigil.length;
    syncAutocomplete();
  };

  const recall = (step: -1 | 1): boolean => {
    const next = Math.min(past.length, Math.max(0, (cursor ?? past.length) + step));
    if (next === past.length && cursor === null) return false;
    compose(past[next] ?? "");
    cursor = next === past.length ? null : next;
    return true;
  };

  input.onContentChange = syncShellMode;

  const submit = (kind: QueueKind = "follow-up"): void => {
    const text = input.plainText;
    const selected = autocompleteItems[autocompleteIndex]?.name;
    if (autocompleteOpen && autocompleteSigil && autocompleteSigil.query !== selected) {
      completeCommand();
      return;
    }
    // Enter on an empty composer used to do nothing at all, which makes it the
    // one key free to mean "carry on" after Esc held the queue. Routed through
    // onSubmit so the chat decides whether there is anything to release.
    if (text.trim() === "") {
      callbacks.onSubmit("", kind);
      return;
    }
    const dismiss = (): void => {
      autocompleteOpen = false;
      autocompleteItems = [];
      autocompleteSigil = null;
      compose("");
    };
    const invocation = commandInvocation(text);
    if (invocation) {
      dismiss();
      callbacks.onCommand(invocation.name, invocation.args);
      return;
    }
    if (shellMode) {
      shellMode = false;
      syncShellMode();
      compose("");
      callbacks.onShell(text.trim());
      return;
    }
    if (past.at(-1) !== text) past.push(text);
    past.splice(0, past.length - pastLimit);
    callbacks.onPromptHistory?.(past.slice());
    cursor = null;
    compose("");
    callbacks.onSubmit(text, kind);
  };

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
    // Whoever holds the composer area sees every key first, in glorious's own
    // shape rather than the renderer's — the same vocabulary g.key() uses, so
    // an extension never meets an opentui type.
    if (captured) {
      event.stopPropagation();
      captured.onKey({
        key: event.name ?? "",
        ctrl: event.ctrl ?? false,
        shift: event.shift ?? false,
        text:
          !event.ctrl && !event.meta && typeof event.sequence === "string" ? event.sequence : "",
      });
      paintCapture();
      return;
    }
    // An extension's binding runs before anything the composer would do with
    // the key, and consuming it stops the composer seeing it at all.
    if (callbacks.onKeyBinding?.(event)) return;
    if (shellMode && input.plainText === "" && event.name === "backspace") {
      event.stopPropagation();
      shellMode = false;
      syncShellMode();
      return;
    }
    // Both Alt chords are taken before the completion menu and before the
    // textarea's own bindings, which match on name and shift only — Alt+Enter
    // would otherwise reach `return` → submit and queue a follow-up, silently
    // doing the opposite of what was pressed.
    if (isAlt(event) && enterKeys.has(event.name ?? "")) {
      event.stopPropagation();
      submit("steer");
      return;
    }
    if (isAlt(event) && event.name === "up") {
      event.stopPropagation();
      callbacks.onUnqueue();
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
    }
    // Esc closes the completion and leaves what you typed alone — you were
    // dismissing a menu, not abandoning the line. It does not interrupt: the
    // turn is not what you were pointing at.
    //
    // The dismissal is remembered against the text it happened on, so the menu
    // stays shut while you look at it and reopens the moment you type again.
    // Without that, Esc closed the menu and the very next keystroke reopened
    // it; with it but no reset, a second Esc could never reach the interrupt.
    if (event.name === "escape" && autocompleteOpen) {
      event.stopPropagation();
      dismissedAt = input.plainText;
      autocompleteOpen = false;
      autocompleteItems = [];
      autocompleteSigil = null;
      autocompleteIndex = 0;
      draw();
      return;
    }
    // Arrow keys move within what you are typing and only reach for history at
    // the edges, the way a shell does. Ctrl+P/Ctrl+N stay unconditional history,
    // so recalling a long prompt never costs you fast cycling.
    const arrowBack = !event.shift && !isAlt(event) && event.name === "up";
    const arrowForward = !event.shift && !isAlt(event) && event.name === "down";
    const back =
      (arrowBack && atFirstLine(input.plainText, input.cursorOffset)) ||
      (event.ctrl && event.name === "p");
    const forward =
      (arrowForward && atLastLine(input.plainText, input.cursorOffset)) ||
      (event.ctrl && event.name === "n");
    // moving inside the draft keeps your place in history rather than dropping it
    if (!back && !forward && !arrowBack && !arrowForward) cursor = null;
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
    for (const block of log) {
      block.block.width = columns();
      block.node.width = columns();
      block.node.content = styled(block.lines);
    }
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
    // A block that is still arriving. Creating it once and then rewriting its
    // node is exactly what onResize already does to every logged block, so the
    // streaming path reuses that rather than inventing a second mechanism.
    draft: (lines: Line[], gap: boolean) => {
      if (drafting === null) {
        printBlock(lines, gap);
        drafting = log.length - 1;
        return;
      }
      const entry = log[drafting];
      if (!entry) return;
      entry.lines = lines;
      entry.node.content = styled(lines);
      draw();
    },
    // Freeze the draft in place. Passing lines rewrites it one last time, which
    // is how a streamed answer becomes its final recorded form without a second
    // block being printed.
    sealDraft: (lines?: Line[]) => {
      const entry = drafting === null ? undefined : log[drafting];
      drafting = null;
      if (!entry || !lines) return entry !== undefined;
      entry.lines = lines;
      entry.node.content = styled(lines);
      draw();
      return true;
    },
    isDrafting: () => drafting !== null,
    print: printBlock,
    setProgress: painter(progress),
    setFooter: painter(extra),
    // Through the same painter dedupe as everything else: nothing animates now,
    // so a tick where no number moved must cost no render at all.
    // The lines are decided by index.ts, which gives an extension the first
    // refusal; this only paints what it is handed.
    setStatusRow: (lines: Line[]) => paintActivity(lines),
    columnsNow: columns,
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
    capture,
  };
};
