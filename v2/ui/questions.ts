import type { KeyEvent, Renderable, TextareaRenderable, TextRenderable } from "@opentui/core";
import { composerKeyBindings } from "../composer";
import { width } from "../render";
import type { Question } from "../tools";
import { type Chrome, dimHex, edgeHex, fillHex, type Host } from "./chrome";

export const createQuestions = (chrome: Chrome, host: Host) => {
  const { tui, renderer, columns, textNode, stack, styled } = chrome;

  let view: Renderable | null = null;
  let title: TextRenderable | null = null;
  let options: ReturnType<typeof stack> | null = null;
  let optionViews: Array<{
    box: ReturnType<typeof stack>;
    text: TextRenderable;
    value: string;
  }> = [];
  let selectedIndex = 0;
  let note: TextareaRenderable | null = null;
  let index = 0;
  let items: Question[] = [];
  let answers: Array<{ question: string; option: string | null; note: string }> = [];
  let optionTouched = false;
  let resolveWith: ((result: string) => void) | null = null;
  let abort: (() => void) | null = null;
  let cleanup: (() => void) | null = null;
  let focus: "options" | "note" = "options";

  const closeView = (): void => {
    if (view) {
      host.useComposerSlot(null);
      view.destroy();
    }
    view = null;
    title = null;
    options = null;
    optionViews = [];
    selectedIndex = 0;
    note = null;
    items = [];
    answers = [];
    index = 0;
    host.focusComposer();
    host.draw();
  };

  const finish = (result: string): void => {
    const resolve = resolveWith;
    resolveWith = null;
    abort = null;
    cleanup?.();
    cleanup = null;
    closeView();
    resolve?.(result);
  };

  const paint = (): void => {
    const current = items[index];
    if (!current || !title || !options || !note) return;
    const contentWidth = Math.max(1, columns() - 2);
    const questionText = current.question.replaceAll("\n", " ");
    const questionLines = Math.max(1, Math.ceil(width(questionText) / contentWidth));
    title.height = questionLines + 1;
    title.content = styled([
      [{ text: `? Question ${index + 1}/${items.length}`, tone: "accent", bold: true }],
      [{ text: questionText, bold: true }],
    ]);
    selectedIndex = 0;
    optionsViews(current.options, Math.max(1, columns() - 4));
    const optionRows = optionViews.reduce((total, option) => total + option.box.height, 0);
    if (view) view.height = questionLines + optionRows + current.options.length + 13;
    note.setText("");
    optionTouched = false;
    focus = "options";
    paintOptions();
    host.draw();
  };

  const submit = (): void => {
    if (!options || !note) return;
    const current = items[index];
    const selected = optionViews[selectedIndex]?.value;
    const written = note.plainText.trim();
    const option =
      optionTouched || written === "" ? (typeof selected === "string" ? selected : null) : null;
    if (!current || (option === null && written === "")) return;
    answers.push({ question: current.question, option, note: written });
    if (index + 1 < items.length) {
      index += 1;
      paint();
      return;
    }
    finish(JSON.stringify({ answers }));
  };

  const ask = (questions: Question[], signal: AbortSignal | undefined): Promise<string> =>
    // One modal, one asker. Two tool calls in a single step run concurrently, and
    // without this the second would overwrite resolveWith and strand the first.
    view !== null
      ? Promise.resolve(JSON.stringify({ error: "another question is already open" }))
      : new Promise((resolve) => {
          items = questions;
          answers = [];
          index = 0;
          resolveWith = resolve;
          abort = () => finish(JSON.stringify({ cancelled: true }));
          title = textNode({ content: "", width: "100%", wrapMode: "word" });
          const optionsLabel = textNode({
            content: "OPTIONS · choose one",
            width: "100%",
            height: 1,
            fg: dimHex,
          });
          options = stack(
            {
              flexDirection: "column",
              width: "100%",
              minWidth: 0,
              backgroundColor: fillHex,
            },
            [],
          );
          const noteLabel = textNode({
            content: "NOTE · optional",
            width: "100%",
            height: 1,
            fg: dimHex,
          });
          note = new tui.TextareaRenderable(renderer, {
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
            onSubmit: submit,
          });
          const help = textNode({
            content: "Tab note · Enter next · Esc cancel",
            width: "100%",
            height: 1,
            fg: dimHex,
          });
          // Styled as the composer is, because it stands in for the composer.
          view = stack(
            {
              flexDirection: "column",
              width: "100%",
              height: 1,
              paddingTop: 1,
              paddingX: 1,
              rowGap: 1,
              backgroundColor: fillHex,
            },
            [title, optionsLabel, options, noteLabel, note, help],
          );
          host.useComposerSlot(view);
          const cancel = (): void => abort?.();
          signal?.addEventListener("abort", cancel, { once: true });
          cleanup = () => signal?.removeEventListener("abort", cancel);
          paint();
        });

  const optionsViews = (values: string[], contentWidth: number): void => {
    const list = options;
    if (!list) return;
    for (const option of optionViews) list.remove(option.box);
    optionViews = values.map((value, at) => {
      const text = textNode({
        content: "",
        width: "100%",
        height: Math.max(1, Math.ceil(width(`  ${value}`) / contentWidth)),
        wrapMode: "word",
      });
      const box = stack(
        {
          width: "100%",
          minWidth: 0,
          height: text.height,
          marginBottom: at + 1 < values.length ? 1 : 0,
          backgroundColor: at === selectedIndex ? edgeHex : fillHex,
        },
        [text],
      );
      list.add(box);
      return { box, text, value };
    });
  };

  const paintOptions = (): void => {
    for (const [at, option] of optionViews.entries()) {
      const indicator = at === selectedIndex ? "▶ " : "  ";
      option.text.content = styled([[{ text: `${indicator}${option.value}` }]]);
      option.box.backgroundColor = at === selectedIndex ? edgeHex : fillHex;
    }
  };

  const handleKey = (event: KeyEvent): boolean => {
    if (!view) return false;
    if (event.ctrl && event.name === "c") {
      event.stopPropagation();
      abort?.();
    } else if (event.name === "escape") {
      event.stopPropagation();
      abort?.();
    } else if (event.name === "tab") {
      event.stopPropagation();
      focus = focus === "options" ? "note" : "options";
      if (focus === "options") paintOptions();
      else note?.focus();
    } else if (focus === "options" && (event.name === "up" || event.name === "down")) {
      event.stopPropagation();
      const direction = event.name === "up" ? -1 : 1;
      selectedIndex = Math.min(optionViews.length - 1, Math.max(0, selectedIndex + direction));
      optionTouched = true;
      paintOptions();
      host.draw();
    } else if (focus === "options" && (event.name === "return" || event.name === "kpenter")) {
      event.stopPropagation();
      submit();
    }
    return true;
  };

  return { ask, handleKey, isOpen: () => view !== null };
};
