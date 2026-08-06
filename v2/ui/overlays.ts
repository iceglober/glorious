import type { KeyEvent, Renderable } from "@opentui/core";
import { commands } from "../commands";
import { clip, type Line } from "../render";
import type { SkillSummary } from "../skills";
import { type Chrome, dimHex, edgeHex, type Host, panelHex } from "./chrome";

export const createOverlays = (chrome: Chrome, host: Host) => {
  const { tui, renderer, columns, textNode, stack, styled } = chrome;
  let view: Renderable | null = null;
  let scroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;

  const close = (): void => {
    if (!view) return;
    renderer.root.remove(view);
    view.destroy();
    view = null;
    scroll = null;
    host.focusComposer();
    host.draw();
  };

  const open = (node: Renderable): void => {
    view = node;
    renderer.root.add(node);
    host.blurComposer();
    host.draw();
  };

  const showHelp = (): void => {
    if (view) return;
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
    open(
      stack(
        {
          position: "absolute",
          top: 2,
          left: 4,
          width: Math.max(1, columns() - 8),
          height: 9,
          paddingX: 2,
          paddingY: 1,
          backgroundColor: panelHex,
          border: true,
          borderColor: edgeHex,
          title: " Help ",
          titleColor: "#67d4e8",
          zIndex: 10,
        },
        [body],
      ),
    );
  };

  const showSkills = (summaries: readonly SkillSummary[]): void => {
    if (view) return;
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
      content: "↑/↓ scroll · Esc closes this list",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      stack(
        {
          position: "absolute",
          top: Math.max(0, Math.floor((renderer.terminalHeight - modalHeight) / 2)),
          left: Math.max(0, Math.floor((columns() - modalWidth) / 2)),
          width: modalWidth,
          height: modalHeight,
          paddingX: 2,
          paddingY: 1,
          backgroundColor: panelHex,
          border: true,
          borderColor: edgeHex,
          title: " Skills ",
          titleColor: "#67d4e8",
          zIndex: 10,
        },
        [header, scroll, footer],
      ),
    );
  };

  const handleKey = (event: KeyEvent): boolean => {
    if (!view) return false;
    if (event.name === "escape" || (event.ctrl && event.name === "c")) {
      event.stopPropagation();
      close();
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

  return { showHelp, showSkills, handleKey, close, isOpen: () => view !== null };
};
