import type { KeyEvent, Renderable, TextareaRenderable, TextRenderable } from "@opentui/core";
import { composerKeyBindings } from "../composer";
import { width } from "../render";
import type { Question } from "../tools";
import { type Chrome, dimHex, edgeHex, fillHex, type Host, panelHex } from "./chrome";

export const createQuestions = (chrome: Chrome, host: Host) => {
  const { tui, renderer, columns, textNode, stack, styled } = chrome;

  let view: Renderable | null = null;
  let title: TextRenderable | null = null;
  let options: InstanceType<typeof tui.SelectRenderable> | null = null;
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
      renderer.root.remove(view);
      view.destroy();
    }
    view = null;
    title = null;
    options = null;
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
    const contentWidth = Math.max(1, columns() - 4);
    const questionText = current.question.replaceAll("\n", " ");
    const questionLines = Math.max(1, Math.ceil(width(questionText) / contentWidth));
    title.height = questionLines + 1;
    title.content = styled([
      [{ text: `? Question ${index + 1}/${items.length}`, tone: "accent", bold: true }],
      [{ text: questionText, bold: true }],
    ]);
    if (view) view.height = questionLines + current.options.length + 11;
    options.height = current.options.length;
    options.options = current.options.map((option) => ({
      name: option,
      description: "",
      value: option,
    }));
    note.setText("");
    optionTouched = false;
    focus = "options";
    options.focus();
    host.draw();
  };

  const submit = (): void => {
    if (!options || !note) return;
    const current = items[index];
    const selected = options.getSelectedOption()?.value;
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
    new Promise((resolve) => {
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
      options = new tui.SelectRenderable(renderer, {
        width: "100%",
        height: 1,
        backgroundColor: fillHex,
        focusedBackgroundColor: fillHex,
        selectedBackgroundColor: edgeHex,
        selectedTextColor: "#ffffff",
        showDescription: false,
        itemSpacing: 0,
      });
      options.on("selectionChanged", () => {
        optionTouched = true;
      });
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
      view = stack(
        {
          flexDirection: "column",
          width: "100%",
          height: 1,
          paddingX: 2,
          paddingY: 1,
          rowGap: 0,
          backgroundColor: panelHex,
          border: true,
          borderColor: edgeHex,
          title: " Questions ",
          titleColor: "#67d4e8",
        },
        [title, optionsLabel, options, noteLabel, note, help],
      );
      renderer.root.add(view);
      const cancel = (): void => abort?.();
      signal?.addEventListener("abort", cancel, { once: true });
      cleanup = () => signal?.removeEventListener("abort", cancel);
      paint();
    });

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
      if (focus === "options") options?.focus();
      else note?.focus();
    } else if (focus === "options" && (event.name === "return" || event.name === "kpenter")) {
      event.stopPropagation();
      submit();
    }
    return true;
  };

  return { ask, handleKey, isOpen: () => view !== null };
};
