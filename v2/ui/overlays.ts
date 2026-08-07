import type { KeyEvent, Renderable, TextRenderable } from "@opentui/core";
import { commands } from "../commands";
import { clip, type Line } from "../render";
import type { McpServerSummary } from "../mcp";
import type { SkillSummary } from "../skills";
import { type Chrome, dimHex, type Host, listChrome, panelHeight, panelHex } from "./chrome";

export const createOverlays = (
  chrome: Chrome,
  host: Host,
  onSkillsReload: () => void,
  onMcpReload: (setLoading: (loading: boolean) => void) => void,
) => {
  const { tui, renderer, textNode, styled, panel, panelWidth, panelRows } = chrome;
  let view: Renderable | null = null;
  let scroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;
  let toolSearch: { focused: boolean; activate: (text: string) => void } | null = null;
  let toolList: { moveUp: () => void; moveDown: () => void } | null = null;
  let reloadSkills = false;
  let reloadMcp = false;
  let mcpLoading = false;
  let mcpFrame = 0;
  let mcpTimer: ReturnType<typeof setInterval> | null = null;
  let mcpLoadingView: ((loading: boolean) => void) | null = null;

  const close = (): void => {
    if (!view) return;
    renderer.root.remove(view);
    view.destroy();
    view = null;
    scroll = null;
    toolSearch = null;
    toolList = null;
    reloadMcp = false;
    mcpLoading = false;
    if (mcpTimer) clearInterval(mcpTimer);
    mcpTimer = null;
    mcpLoadingView = null;
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

  const showMcp = (servers: readonly McpServerSummary[], notes: readonly string[]): void => {
    if (view) return;
    const modalWidth = panelWidth();
    let mcpBody: TextRenderable | null = null;
    const render = (): void => {
      const marker = mcpLoading ? ["◐", "◓", "◑", "◒"][mcpFrame % 4] : "◆";
      const lines: Line[] =
        servers.length === 0
          ? [
              [
                { text: `${marker} `, tone: "accent" },
                { text: "No active MCP servers.", tone: "muted" },
              ],
            ]
          : servers.flatMap((server, index): Line[] => [
              [
                { text: `${marker} `, tone: "accent" },
                { text: server.name, tone: "highlight", bold: true },
                { text: `  ${server.tools} tools`, tone: "muted" },
              ],
              ...(index + 1 < servers.length ? [[{ text: "" }]] : []),
            ]);
      const noteLines: Line[] = notes.flatMap((note): Line[] => [
        [
          { text: "! ", tone: "warning" },
          { text: note, tone: "muted" },
        ],
      ]);
      const allLines = [...lines, ...(noteLines.length > 0 ? [[{ text: "" }], ...noteLines] : [])];
      if (mcpBody) mcpBody.content = styled(allLines);
      host.draw();
    };
    const listHeight = Math.max(3, panelRows() - listChrome);
    const header = textNode({
      content: styled([[{ text: "Active MCP servers", tone: "accent", bold: true }]]),
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
    mcpBody = textNode({ content: "", width: "100%", wrapMode: "none" });
    scroll.add(mcpBody);
    render();
    const footer = textNode({
      content: "↑/↓ scroll · r reload · Esc closes this list",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      panel({ title: "MCP", width: modalWidth, height: panelHeight(listHeight + listChrome) }, [
        header,
        gap(),
        scroll,
        gap(),
        footer,
      ]),
    );
    reloadMcp = true;
    mcpLoadingView = (loading: boolean): void => {
      mcpLoading = loading;
      mcpFrame = 0;
      render();
    };
    mcpTimer = setInterval(() => {
      if (!mcpLoading) return;
      mcpFrame += 1;
      render();
    }, 120);
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
    } else if (reloadMcp && event.name === "r") {
      event.stopPropagation();
      if (mcpLoading || !mcpLoadingView) return true;
      onMcpReload(mcpLoadingView);
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

  return { showHelp, showSkills, showMcp, handleKey, close, isOpen: () => view !== null };
};
