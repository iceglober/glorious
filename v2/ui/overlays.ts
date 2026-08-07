import type { KeyEvent, Renderable } from "@opentui/core";
import { commands } from "../commands";
import { clip, type Line } from "../render";
import type { SkillSummary } from "../skills";
import type { ToolSummary } from "../tools";
import { type Chrome, dimHex, type Host, listChrome, panelHeight, panelHex } from "./chrome";

export const createOverlays = (chrome: Chrome, host: Host, onSkillsReload: () => void) => {
  const { tui, renderer, textNode, styled, panel, panelWidth, panelRows } = chrome;
  let view: Renderable | null = null;
  let scroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;
  let reloadSkills = false;

  const close = (): void => {
    if (!view) return;
    renderer.root.remove(view);
    view.destroy();
    view = null;
    scroll = null;
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

  const showHelp = (): void => {
    if (view) return;
    const lines: Line[] = [
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
    ];
    const body = textNode({ content: styled(lines), width: "100%", wrapMode: "word" });
    open(
      panel(
        {
          title: "Help",
          width: panelWidth(),
          height: panelHeight(Math.min(lines.length, panelRows())),
        },
        [body],
      ),
    );
  };

  const gap = () => textNode({ content: "", width: "100%", height: 1 });

  const showSkills = (summaries: readonly SkillSummary[]): void => {
    if (view) return;
    const modalWidth = panelWidth();
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
      Math.min(skillLines.length, Math.max(3, panelRows() - listChrome)),
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
      backgroundColor: panelHex,
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
      panel({ title: "Skills", width: modalWidth, height: panelHeight(listHeight + listChrome) }, [
        header,
        gap(),
        scroll,
        gap(),
        footer,
      ]),
      true,
    );
  };

  const showTools = (summaries: readonly ToolSummary[]): void => {
    if (view) return;
    const modalWidth = panelWidth();
    const contentWidth = Math.max(1, modalWidth - 6);
    const toolLines: Line[] = summaries.flatMap((tool, index): Line[] => {
      const name = clip(tool.name, contentWidth);
      const description = clip(tool.description, Math.max(1, contentWidth - 2));
      const source = clip(tool.source, Math.max(1, contentWidth - 6));
      return [
        [
          { text: "◆ ", tone: "accent" },
          { text: name, tone: "highlight", bold: true },
        ],
        [{ text: "  " }, { text: description, tone: "muted" }],
        [
          { text: "  ↳ ", tone: "muted" },
          { text: source, tone: "muted", italic: true },
        ],
        ...(index + 1 < summaries.length ? [[{ text: "" }]] : []),
      ];
    });
    const listHeight = Math.max(
      1,
      Math.min(toolLines.length, Math.max(3, panelRows() - listChrome)),
    );
    const header = textNode({
      content: styled([[{ text: "Available tools", tone: "accent", bold: true }]]),
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
      backgroundColor: panelHex,
      contentOptions: { flexDirection: "column" },
    });
    scroll.add(textNode({ content: styled(toolLines), width: "100%", wrapMode: "none" }));
    const footer = textNode({
      content: "↑/↓ scroll · Esc closes this list",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      panel({ title: "Tools", width: modalWidth, height: panelHeight(listHeight + listChrome) }, [
        header,
        gap(),
        scroll,
        gap(),
        footer,
      ]),
    );
  };

  const handleKey = (event: KeyEvent): boolean => {
    if (!view) return false;
    if (event.name === "escape" || (event.ctrl && event.name === "c")) {
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

  return { showHelp, showSkills, showTools, handleKey, close, isOpen: () => view !== null };
};
