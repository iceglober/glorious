import type { KeyEvent, Renderable, TextRenderable } from "@opentui/core";
import { commands } from "../commands";
import type { McpServerSummary } from "../mcp";
import type { ModelOption } from "../models";
import type { Mode } from "../modes";
import { clip, type Line } from "../render";
import type { SkillSummary } from "../skills";
import { type Chrome, dimHex, fillHex, type Host, listChrome, sheetHeight } from "./chrome";

export const createOverlays = (
  chrome: Chrome,
  host: Host,
  onSkillsReload: () => void,
  onMcpReload: (setLoading: (loading: boolean) => void) => void,
) => {
  const { tui, renderer, columns, textNode, styled, sheet, sheetRows } = chrome;
  let view: Renderable | null = null;
  let scroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;
  let toolSearch: { focused: boolean; activate: (text: string) => void } | null = null;
  let toolList: { moveUp: () => void; moveDown: () => void } | null = null;
  let modelSearch: {
    picker: InstanceType<typeof tui.SelectRenderable>;
    models: readonly ModelOption[];
    query: string;
    header: TextRenderable;
  } | null = null;
  let reloadSkills = false;
  let reloadMcp = false;
  let mcpLoading = false;
  let mcpFrame = 0;
  let mcpTimer: ReturnType<typeof setInterval> | null = null;
  let mcpLoadingView: ((loading: boolean) => void) | null = null;

  const close = (): void => {
    if (!view) return;
    host.useComposerSlot(null);
    view.destroy();
    view = null;
    scroll = null;
    toolSearch = null;
    toolList = null;
    modelSearch = null;
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
    host.useComposerSlot(node);
    host.blurComposer();
    host.draw();
  };

  const showHelp = (): void => {
    if (view) return;
    const lines: Line[] = [
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
      sheet({ title: "Help", height: sheetHeight(Math.min(lines.length, sheetRows())) }, [body]),
    );
  };

  const gap = () => textNode({ content: "", width: "100%", height: 1 });

  const showSkills = (summaries: readonly SkillSummary[]): void => {
    if (view) return;
    const contentWidth = Math.max(1, columns() - 6);
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
        gap(),
        scroll,
        gap(),
        footer,
      ]),
      true,
    );
  };

  const showModes = (
    modes: readonly Mode[],
    active: string,
    onSelect: (name: string) => void,
  ): void => {
    if (view) return;
    // the sheet is sized from this, not from modes.length — the floor of 3 would
    // otherwise push the key legend off the bottom whenever there are fewer
    const listHeight = Math.max(3, Math.min(modes.length, sheetRows() - listChrome));
    const picker = new tui.SelectRenderable(renderer, {
      width: "100%",
      height: listHeight,
      options: modes.map((mode) => ({
        name: mode.name === active ? `${mode.name}  (current)` : mode.name,
        description: mode.description,
        value: mode.name,
      })),
    });
    picker.selectedIndex = Math.max(
      0,
      modes.findIndex((mode) => mode.name === active),
    );
    picker.on("itemSelected", () => {
      const chosen = picker.getSelectedOption()?.value as string | undefined;
      close();
      if (chosen) onSelect(chosen);
    });
    const legend = textNode({
      // the picker renders plain names, so the colour each mode carries in the
      // composer is only learnable here
      content: styled([
        modes.flatMap((mode, index) => [
          ...(index === 0 ? [] : [{ text: "   " }]),
          { text: "● ", tone: mode.tone },
          { text: mode.name, tone: mode.tone, bold: true },
        ]),
      ]),
      width: "100%",
      height: 1,
      wrapMode: "none",
    });
    const footer = textNode({
      content: "↑/↓ choose · Enter switch · Tab cycles · Esc cancel",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet({ title: "Mode", height: sheetHeight(listHeight + listChrome) }, [
        legend,
        gap(),
        picker,
        gap(),
        footer,
      ]),
    );
    picker.focus();
  };

  const modelScore = (query: string, model: ModelOption): number | null => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return 0;
    const fields = [model.provider, model.modelId, model.name].map((field) => field.toLowerCase());
    let best: number | null = null;
    for (const field of fields) {
      const exact = field === needle ? 1000 : null;
      const prefix = field.startsWith(needle) ? 700 - field.length : null;
      const included = field.includes(needle) ? 500 - field.length : null;
      let at = 0;
      let consecutive = 0;
      let score = 0;
      for (const char of needle) {
        const found = field.indexOf(char, at);
        if (found < 0) {
          score = -1;
          break;
        }
        score += found === at ? 12 : 2;
        if (found === at) consecutive += 1;
        at = found + 1;
      }
      const subsequence = score < 0 ? null : 100 + score + consecutive * 4 - field.length / 100;
      const candidate = Math.max(
        exact ?? -Infinity,
        prefix ?? -Infinity,
        included ?? -Infinity,
        subsequence ?? -Infinity,
      );
      if (candidate !== -Infinity && (best === null || candidate > best)) best = candidate;
    }
    return best;
  };

  const showModelVariants = (model: ModelOption, onSelect: (model: ModelOption) => void): void => {
    const variants = [...new Set(model.variants ?? [])];
    const picker = new tui.SelectRenderable(renderer, {
      width: "100%",
      height: Math.max(3, Math.min(variants.length + 1, sheetRows())),
      showScrollIndicator: true,
      options: [
        { name: "Default", description: "Use the provider default", value: "" },
        ...variants.map((variant) => ({
          name: variant,
          description: `Use ${variant} reasoning effort`,
          value: variant,
        })),
      ],
    });
    picker.on("itemSelected", () => {
      const variant = picker.getSelectedOption()?.value as string | undefined;
      close();
      onSelect({ ...model, variant: variant || undefined });
    });
    open(sheet({ title: `${model.name} variant`, height: sheetHeight(picker.height) }, [picker]));
    picker.focus();
  };

  const showModels = (
    models: readonly ModelOption[],
    onSelect: (model: ModelOption) => void,
  ): void => {
    if (view) return;
    const modelOptions = (query: string) =>
      models
        .map((model, index) => ({ model, index, score: modelScore(query, model) }))
        .filter(
          (item): item is { model: ModelOption; index: number; score: number } =>
            item.score !== null,
        )
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(({ model }) => ({
          name: model.name,
          description: [
            `${model.provider}/${model.modelId}`,
            model.inputCost !== undefined && model.outputCost !== undefined
              ? `$${model.inputCost}/$${model.outputCost} per 1M tokens`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          value: model,
        }));
    const listHeight = Math.max(3, sheetRows() - listChrome);
    const header = textNode({ content: "", width: "100%", height: 1, fg: dimHex });
    const picker = new tui.SelectRenderable(renderer, {
      width: "100%",
      height: listHeight,
      showScrollIndicator: true,
      options: modelOptions(""),
    });
    const renderSearch = (): void => {
      const query = modelSearch?.query ?? "";
      picker.options = modelOptions(query);
      picker.selectedIndex = 0;
      header.content = styled([
        [{ text: query === "" ? "Type to search models" : `Search: ${query}`, tone: "accent" }],
      ]);
      host.draw();
    };
    modelSearch = { picker, models, query: "", header };
    picker.on("itemSelected", () => {
      const selected = picker.getSelectedOption()?.value as ModelOption | undefined;
      close();
      if (!selected) return;
      if ((selected.variants?.length ?? 0) > 0) showModelVariants(selected, onSelect);
      else onSelect(selected);
    });
    renderSearch();
    const footer = textNode({
      content: "Type to filter · ↑/↓ select · Enter switch · Esc closes",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet({ title: "Models", height: sheetHeight(listHeight + listChrome) }, [
        header,
        gap(),
        picker,
        gap(),
        footer,
      ]),
    );
    picker.focus();
  };

  const showModelError = (message: string): void => {
    if (view) return;
    const body = textNode({
      content: styled([[{ text: message, tone: "danger" }]]),
      width: "100%",
      wrapMode: "word",
    });
    open(sheet({ title: "Models", height: sheetHeight(1) }, [body]));
  };

  const showMcp = (servers: readonly McpServerSummary[], notes: readonly string[]): void => {
    if (view) return;
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
    const listHeight = Math.max(3, sheetRows() - listChrome);
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
      sheet({ title: "MCP", height: sheetHeight(listHeight + listChrome) }, [
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
    if (modelSearch && !event.ctrl && !event.meta && !event.option) {
      if (event.name === "backspace") {
        event.stopPropagation();
        modelSearch.query = modelSearch.query.slice(0, -1);
        modelSearch.header.content = styled([
          [
            {
              text:
                modelSearch.query === "" ? "Type to search models" : `Search: ${modelSearch.query}`,
              tone: "accent",
            },
          ],
        ]);
        modelSearch.picker.options = modelSearch.models
          .map((model, index) => ({
            model,
            index,
            score: modelScore(modelSearch?.query ?? "", model),
          }))
          .filter(
            (item): item is { model: ModelOption; index: number; score: number } =>
              item.score !== null,
          )
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map(({ model }) => ({
            name: model.name,
            description: `${model.provider}/${model.modelId}`,
            value: model,
          }));
        modelSearch.picker.selectedIndex = 0;
        host.draw();
      } else if (event.sequence.length === 1 && event.name.length === 1) {
        event.stopPropagation();
        modelSearch.query += event.sequence;
        modelSearch.header.content = styled([
          [{ text: `Search: ${modelSearch.query}`, tone: "accent" }],
        ]);
        modelSearch.picker.options = modelSearch.models
          .map((model, index) => ({
            model,
            index,
            score: modelScore(modelSearch?.query ?? "", model),
          }))
          .filter(
            (item): item is { model: ModelOption; index: number; score: number } =>
              item.score !== null,
          )
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map(({ model }) => ({
            name: model.name,
            description: `${model.provider}/${model.modelId}`,
            value: model,
          }));
        modelSearch.picker.selectedIndex = 0;
        host.draw();
      }
    }
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

  return {
    showHelp,
    showModes,
    showSkills,
    showMcp,
    showModels,
    showModelError,
    handleKey,
    close,
    isOpen: () => view !== null,
  };
};
