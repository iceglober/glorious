import type { KeyEvent, TextRenderable } from "@opentui/core";
import { activeSlash, commandName, matchingCommands } from "../commands";
import { composerKeyBindings, composerWrapMode } from "../composer";
import type { McpServerSummary } from "../mcp";
import type { Line } from "../render";
import type { SkillSummary } from "../skills";
import type { Question } from "../tools";
import { createChrome, fillHex, panelHex } from "./chrome";
import { createOverlays } from "./overlays";
import { createQuestions } from "./questions";

const fatalSignals = ["SIGTERM", "SIGHUP"] as const;
const pastLimit = 100;
const quitMs = 3000;
const quitLine: Line = [{ text: "Ctrl+C again to exit", tone: "warning" }];

export const createScreen = async (callbacks: {
  promptHistory?: string[];
  onPromptHistory?: (history: string[]) => void;
  onSubmit: (text: string) => void;
  onShell: (command: string) => void;
  cwd: string;
  onCommand: (name: string) => void;
  onSkillsReload: () => void;
  onMcpReload: (setLoading: (loading: boolean) => void) => void;
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
  const status = textNode({ content: "", wrapMode: "word", width: "100%" });
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
  let autocompleteSlash: { start: number; query: string } | null = null;
  let autocompleteItems: ReturnType<typeof matchingCommands> = [];
  let autocompleteIndex = 0;
  let autocompleteOpen = false;
  let shellMode = false;

  const draw = (): void => {
    if (phase === "live") renderer.requestRender();
  };

  const host = {
    draw,
    focusComposer: () => input.focus(),
    blurComposer: () => input.blur(),
  };
  const overlays = createOverlays(chrome, host, callbacks.onSkillsReload, callbacks.onMcpReload);
  const questions = createQuestions(chrome, host);

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
    autocomplete.backgroundColor = autocompleteOpen ? panelHex : "transparent";
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

  const recall = (step: -1 | 1): boolean => {
    const next = Math.min(past.length, Math.max(0, (cursor ?? past.length) + step));
    if (next === past.length && cursor === null) return false;
    compose(past[next] ?? "");
    cursor = next === past.length ? null : next;
    return true;
  };

  input.onContentChange = syncShellMode;

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
    callbacks.onSubmit(text);
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
    if (overlays.handleKey(event)) return;
    if (questions.handleKey(event)) return;
    if (shellMode && input.plainText === "" && event.name === "backspace") {
      event.stopPropagation();
      shellMode = false;
      syncShellMode();
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
    overlays.close();
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
    showHelp: overlays.showHelp,
    showSkills: (summaries: readonly SkillSummary[]) => overlays.showSkills(summaries),
    showMcp: (servers: readonly McpServerSummary[], notes: readonly string[]) =>
      overlays.showMcp(servers, notes),
    askQuestions: (items: Question[], signal: AbortSignal | undefined) =>
      questions.ask(items, signal),
  };
};
