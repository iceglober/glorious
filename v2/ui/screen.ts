import type { KeyEvent, Renderable, TextRenderable } from "@opentui/core";
import {
  activeSigil,
  commandInvocation,
  matchingCommands,
  matchNames,
  shortcutInvocation,
} from "../commands";
import { atFirstLine, atLastLine, composerKeyBindings, composerWrapMode } from "../composer";
import type { McpServerSummary } from "../mcp";
import type { ModelOption, ProviderOption } from "../models";
import { type Line, statusWave } from "../render";
import type { Sequence } from "../sequences";
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
  onCommand: (name: string, args: string) => void;
  onShortcut: (name: string, args: string) => void;
  sequences?: readonly Sequence[];
  onSkillsReload: () => void;
  onMcpReload: (setLoading: (loading: boolean) => void) => void;
  onMcpApprove: (name: string) => void;
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
  let autocompleteSigil: { sigil: string; start: number; query: string } | null = null;
  let autocompleteItems: readonly { name: string; description: string }[] = [];
  let autocompleteIndex = 0;
  let autocompleteOpen = false;
  let shellMode = false;
  let sequences: readonly Sequence[] = callbacks.sequences ?? [];
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
  const overlays = createOverlays(
    chrome,
    host,
    callbacks.onSkillsReload,
    callbacks.onMcpReload,
    callbacks.onMcpApprove,
  );
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
    // `$` is withheld in shell mode: there every `$VAR` is a real variable, and
    // offering to complete it would fight what is being typed.
    autocompleteSigil = activeSigil(
      input.plainText,
      input.cursorOffset,
      shellMode ? ["/"] : ["/", "$"],
    );
    const matches =
      autocompleteSigil === null
        ? []
        : autocompleteSigil.sigil === "$"
          ? matchNames(sequences, autocompleteSigil.query)
          : matchingCommands(autocompleteSigil.query);
    const sigil = autocompleteSigil?.sigil ?? "/";
    autocompleteItems = matches;
    autocompleteIndex = Math.min(autocompleteIndex, Math.max(0, matches.length - 1));
    autocompleteLabel.content = styled(
      matches.map(
        (item, index): Line => [
          { text: index === autocompleteIndex ? "› " : "  ", tone: "accent" },
          {
            text: `${sigil}${item.name}`,
            tone: index === autocompleteIndex ? "accent" : "highlight",
            bold: true,
          },
          { text: `  ${item.description}`, tone: "muted" },
        ],
      ),
    );
    autocompleteOpen = matches.length > 0;
    autocomplete.height = Math.max(1, matches.length);
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

  const submit = (): void => {
    const text = input.plainText;
    const selected = autocompleteItems[autocompleteIndex]?.name;
    if (autocompleteOpen && autocompleteSigil && autocompleteSigil.query !== selected) {
      completeCommand();
      return;
    }
    if (text.trim() === "") return;
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
    // Only a name that resolves is routed as a sequence; anything else is
    // prose that happens to start with `$` and belongs in the turn.
    const shortcut = shellMode ? null : shortcutInvocation(text);
    if (shortcut && sequences.some((entry) => entry.name === shortcut.name)) {
      dismiss();
      callbacks.onShortcut(shortcut.name, shortcut.args);
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
        autocompleteSigil = null;
        draw();
        return;
      }
    }
    // Arrow keys move within what you are typing and only reach for history at
    // the edges, the way a shell does. Ctrl+P/Ctrl+N stay unconditional history,
    // so recalling a long prompt never costs you fast cycling.
    const arrowBack = !event.shift && event.name === "up";
    const arrowForward = !event.shift && event.name === "down";
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
    // Extensions are discovered from disk like skills and commands, so the
    // composer has to be told when that list changes or autocomplete keeps
    // offering something the reload dropped.
    setSequences: (next: readonly Sequence[]) => {
      sequences = next;
      syncAutocomplete();
    },
    print: printBlock,
    setProgress: painter(progress),
    setFooter: painter(extra),
    setWave: (
      frame: number,
      busy: boolean,
      queued: number,
      phase?: { name: string; ms: number } | null,
    ) => {
      waterline.content = styled(statusWave(frame, busy, queued, columns(), phase));
      waterline.visible = busy;
      draw();
    },
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
    showHelp: () => overlays.showHelp(sequences),
    showSkills: (summaries: readonly SkillSummary[]) => overlays.showSkills(summaries),
    showExtensions: (loaded: readonly { name: string; origin: string; contributed: string }[]) =>
      overlays.showExtensions(loaded),
    showMcp: (servers: readonly McpServerSummary[], notes: readonly string[]) =>
      overlays.showMcp(servers, notes),
    showModels: (
      models: readonly ModelOption[],
      onSelect: (model: ModelOption) => void,
      onConnect: () => void,
    ) => overlays.showModels(models, onSelect, onConnect),
    showProviders: (
      providers: readonly ProviderOption[],
      onSelect: (provider: ProviderOption) => void,
      onBack: () => void,
    ) => overlays.showProviders(providers, onSelect, onBack),
    showProviderKey: (
      provider: ProviderOption,
      onSave: (key: string) => void,
      onCancel: () => void,
    ) => overlays.showProviderKey(provider, onSave, onCancel),
    showModelError: (message: string) => overlays.showModelError(message),
    askQuestions: (items: Question[], signal: AbortSignal | undefined) => {
      if (overlays.isOpen()) overlays.close();
      return questions.ask(items, signal);
    },
  };
};
