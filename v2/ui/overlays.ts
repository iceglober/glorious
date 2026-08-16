import type { KeyEvent, Renderable } from "@opentui/core";
import { commands } from "../commands";
import { clip, type Line } from "../render";
import type { SkillSummary } from "../skills";

import { type Chrome, dimHex, fillHex, type Host, listChrome, sheetHeight } from "./chrome";

export const createOverlays = (chrome: Chrome, host: Host, onSkillsReload: () => void) => {
  const { tui, renderer, columns, textNode, styled, sheet, sheetRows } = chrome;
  let view: Renderable | null = null;
  let scroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;
  let toolSearch: { focused: boolean; activate: (text: string) => void } | null = null;
  let toolList: { moveUp: () => void; moveDown: () => void } | null = null;
  let reloadSkills = false;

  const close = (): void => {
    if (!view) return;
    renderer.root.remove(view);
    view.destroy();
    view = null;
    scroll = null;
    toolSearch = null;
    toolList = null;
    host.focusComposer();
    host.draw();
  };

  const open = (node: Renderable, reloadable = false): void => {
    view = node;
    reloadSkills = reloadable;
    renderer.root.add(node);
    host.blurComposer();
    host.draw();
  };

  const showHelp = (sequences: readonly { name: string; description: string }[] = []): void => {
    if (view) return;
    // Only shown when the project defines some: a heading over an empty list
    // reads as a broken feature rather than an unused one.
    const sequenceLines: Line[] =
      sequences.length === 0
        ? []
        : [
            [{ text: "" }],
            [{ text: "Sequences", tone: "accent", bold: true }],
            [{ text: "Type $ to run one. These are project scripts, not the model." }],
            [{ text: "" }],
            ...sequences.map(
              (sequence): Line => [
                { text: `$${sequence.name}`, tone: "highlight", bold: true },
                { text: `  ${sequence.description}` },
              ],
            ),
          ];
    const lines: Line[] = [
      [{ text: "Slash commands", tone: "accent", bold: true }],
      [{ text: "Type / anywhere after whitespace to open autocomplete." }],
      [{ text: "Use ↑/↓ to move, Tab to complete, and Enter to run." }],
      [{ text: "" }],
      ...commands().map(
        (command): Line => [
          { text: `/${command.name}`, tone: "highlight", bold: true },
          { text: `  ${command.description}` },
        ],
      ),
      ...sequenceLines,
      [{ text: "" }],
      [{ text: "Esc closes this help", tone: "muted" }],
    ];
    const body = textNode({ content: styled(lines), width: "100%", wrapMode: "word" });
    open(
      sheet(
        {
          title: "Help",
          height: sheetHeight(Math.min(lines.length, sheetRows())),
        },
        [body],
      ),
    );
  };

  const gap = () => textNode({ content: "", width: "100%", height: 1 });

  const showSkills = (summaries: readonly SkillSummary[]): void => {
    if (view) return;
    const modalWidth = columns();
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
    const listHeight = Math.max(
      1,
      Math.min(skillLines.length, Math.max(3, sheetRows() - listChrome)),
    );
    const header = textNode({
      content: styled([[{ text: "Available skills", tone: "accent", bold: true }]]),
      width: "100%",
      height: 1,
    });
    scroll = new tui.ScrollBoxRenderable(renderer, {
      width: "100%",
      height: listHeight,
      minHeight: 1,
      scrollY: true,
      stickyScroll: false,
      stickyStart: "top",
      backgroundColor: fillHex,
      contentOptions: { flexDirection: "column" },
    });
    scroll.add(textNode({ content: styled(skillLines), width: "100%", wrapMode: "none" }));
    const footer = textNode({
      content: "↑/↓ scroll · r reload · Esc closes this list",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet({ title: "Skills", height: sheetHeight(listHeight + listChrome) }, [
        header,
        gap(),
        scroll,
        gap(),
        footer,
      ]),
      true,
    );
  };

  // Extensions run arbitrary code with no approval prompt, so this list is the
  // whole of the security story: what loaded, what it contributed, and the path
  // it came from — checkable at any time rather than agreed to once.
  const showExtensions = (
    loaded: readonly { name: string; origin: string; contributed: string }[],
  ): void => {
    if (view) return;
    const contentWidth = Math.max(1, columns() - 6);
    const lines: Line[] =
      loaded.length === 0
        ? [
            [{ text: "No extensions loaded.", tone: "muted" }],
            [{ text: "" }],
            [
              {
                text: "Drop a .ts file in .glorious/extensions/ that default-exports a",
                tone: "muted",
              },
            ],
            [{ text: "function taking (glorious). See docs/extensions.md.", tone: "muted" }],
          ]
        : loaded.flatMap((entry, index): Line[] => [
            [
              { text: "◆ ", tone: "accent" },
              { text: clip(entry.name, contentWidth), tone: "highlight", bold: true },
            ],
            [{ text: "  " }, { text: clip(entry.contributed, contentWidth), tone: "muted" }],
            [
              { text: "  ↳ ", tone: "muted" },
              { text: clip(entry.origin, contentWidth), tone: "muted", italic: true },
            ],
            ...(index + 1 < loaded.length ? [[{ text: "" }]] : []),
          ]);
    const listHeight = Math.max(1, Math.min(lines.length, Math.max(3, sheetRows() - listChrome)));
    scroll = new tui.ScrollBoxRenderable(renderer, {
      width: "100%",
      height: listHeight,
      minHeight: 1,
      scrollY: true,
      stickyScroll: false,
      stickyStart: "top",
      backgroundColor: fillHex,
      contentOptions: { flexDirection: "column" },
    });
    scroll.add(textNode({ content: styled(lines), width: "100%", wrapMode: "none" }));
    open(
      sheet({ title: "Extensions", height: sheetHeight(listHeight + listChrome) }, [
        textNode({
          content: styled([
            [{ text: "Loaded extensions — these run with your full permissions", tone: "accent" }],
          ]),
          width: "100%",
          height: 1,
        }),
        gap(),
        scroll,
        gap(),
        textNode({
          content: "↑/↓ scroll · Esc closes this list",
          width: "100%",
          height: 1,
          fg: dimHex,
        }),
      ]),
    );
  };

  const handleKey = (event: KeyEvent): boolean => {
    if (!view) return false;
    if (toolList && event.name === "up") {
      event.stopPropagation();
      toolList.moveUp();
      host.draw();
    } else if (toolList && event.name === "down") {
      event.stopPropagation();
      toolList.moveDown();
      host.draw();
    } else if (
      toolSearch &&
      !toolSearch.focused &&
      !event.ctrl &&
      !event.meta &&
      !event.option &&
      event.sequence.length === 1 &&
      event.name.length === 1
    ) {
      event.stopPropagation();
      toolSearch.activate(event.sequence);
    } else if (event.name === "escape" || (event.ctrl && event.name === "c")) {
      event.stopPropagation();
      close();
    } else if (reloadSkills && event.name === "r") {
      event.stopPropagation();
      close();
      onSkillsReload();
    } else if (scroll && event.name === "up") {
      event.stopPropagation();
      scroll.scrollTop = Math.max(0, scroll.scrollTop - 1);
      host.draw();
    } else if (scroll && event.name === "down") {
      event.stopPropagation();
      scroll.scrollTop += 1;
      host.draw();
    }
    return true;
  };

  return {
    showHelp,
    showSkills,
    showExtensions,
    handleKey,
    close,
    isOpen: () => view !== null,
  };
};
