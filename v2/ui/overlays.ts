import type { KeyEvent, Renderable, TextRenderable } from "@opentui/core";
import { commands } from "../commands";
import type { McpServerSummary } from "../mcp";
import type { ModelOption, ProviderOption } from "../models";
import type { Mode } from "../modes";
import { clip, type Line } from "../render";
import type { SkillSummary } from "../skills";

export type SubagentView = {
  task: string;
  stream: ReadonlyArray<{ name: string; detail: string; ok: boolean | null }>;
  tools: number;
  done: boolean;
};

import { type Chrome, dimHex, fillHex, type Host, listChrome, sheetHeight } from "./chrome";
import { createSearchablePicker, type SearchablePicker } from "./searchable-picker";

export const createOverlays = (
  chrome: Chrome,
  host: Host,
  onSkillsReload: () => void,
  onMcpReload: (setLoading: (loading: boolean) => void) => void,
  onMcpApprove: (name: string) => void,
  onCycleSubagent: () => void,
) => {
  const { tui, renderer, columns, textNode, styled, sheet, sheetRows } = chrome;
  let view: Renderable | null = null;
  let scroll: InstanceType<typeof tui.ScrollBoxRenderable> | null = null;
  let toolSearch: { focused: boolean; activate: (text: string) => void } | null = null;
  let toolList: { moveUp: () => void; moveDown: () => void } | null = null;
  let modelSearch: { search: SearchablePicker; onConnect: () => void } | null = null;
  let providerCatalog: { search: SearchablePicker; onBack: () => void } | null = null;
  let providerForm: {
    provider: ProviderOption;
    key: string;
    onSave: (key: string) => void;
    onCancel: () => void;
    render: () => void;
  } | null = null;
  let reloadSkills = false;
  let reloadMcp = false;
  let mcpLoading = false;
  let mcpFrame = 0;
  let mcpTimer: ReturnType<typeof setInterval> | null = null;
  let mcpLoadingView: ((loading: boolean) => void) | null = null;
  let mcpApproval: string | null = null;

  const close = (): void => {
    if (!view) return;
    renderer.root.remove(view);
    view.destroy();
    view = null;
    scroll = null;
    toolSearch = null;
    toolList = null;
    modelSearch = null;
    subagentView = null;
    providerCatalog = null;
    providerForm = null;
    reloadMcp = false;
    mcpLoading = false;
    if (mcpTimer) clearInterval(mcpTimer);
    mcpTimer = null;
    mcpLoadingView = null;
    mcpApproval = null;
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
      ...commands().map(
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

  // A subagent's stream, shown on demand rather than in the session. Rebuilt in
  // place on every frame while open, since the thing being watched is running.
  let subagentView: { body: TextRenderable; footer: TextRenderable } | null = null;

  const subagentLines = (agent: SubagentView, columns: number): Line[] =>
    agent.stream.length === 0
      ? [[{ text: "No tool calls yet.", tone: "muted" }]]
      : agent.stream.map(
          (step): Line => [
            {
              text: step.ok === null ? "· " : step.ok ? "✓ " : "✗ ",
              tone: step.ok === false ? "danger" : step.ok === null ? "muted" : "success",
            },
            { text: step.name, tone: "highlight" },
            { text: `  ${clip(step.detail, Math.max(8, columns - 12))}`, tone: "muted" },
          ],
        );

  const paintSubagents = (agents: readonly SubagentView[], at: number): void => {
    if (!subagentView) return;
    const agent = agents[at];
    if (!agent) {
      close();
      return;
    }
    subagentView.body.content = styled(subagentLines(agent, columns()));
    subagentView.footer.content = `${at + 1}/${agents.length} · ${agent.done ? "finished" : "running"} · ${agent.tools} tools${agents.length > 1 ? " · Tab next" : ""} · Esc closes`;
    host.draw();
  };

  const showSubagents = (agents: readonly SubagentView[], at: number): void => {
    if (view || agents.length === 0) return;
    const rows = Math.max(3, sheetRows() - listChrome);
    scroll = new tui.ScrollBoxRenderable(renderer, {
      width: "100%",
      height: rows,
      minHeight: 1,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
      backgroundColor: fillHex,
      contentOptions: { flexDirection: "column" },
    });
    const body = textNode({ content: "", width: "100%", wrapMode: "none" });
    scroll.add(body);
    const footer = textNode({ content: "", width: "100%", height: 1, fg: dimHex });
    subagentView = { body, footer };
    open(
      sheet({ title: "Subagent", height: sheetHeight(rows + listChrome) }, [
        gap(),
        scroll,
        gap(),
        footer,
      ]),
    );
    paintSubagents(agents, at);
  };

  const showModes = (
    modes: readonly Mode[],
    active: string,
    onSelect: (name: string) => void,
  ): void => {
    if (view) return;
    const picker = new tui.SelectRenderable(renderer, {
      width: "100%",
      height: Math.max(3, Math.min(modes.length, sheetRows() - listChrome)),
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
    open(sheet({ title: "Mode", height: sheetHeight(picker.height) }, [picker]));
    picker.focus();
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
    onConnect: () => void,
  ): void => {
    if (view) return;
    const search = createSearchablePicker({
      chrome,
      host,
      height: Math.max(3, sheetRows() - listChrome),
      placeholder: "Type to search models",
      items: models.map((model) => ({
        name: model.name,
        description: [
          `${model.provider}/${model.modelId}`,
          model.inputCost !== undefined && model.outputCost !== undefined
            ? `$${model.inputCost}/$${model.outputCost} per 1M tokens`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        fields: [model.provider, model.modelId, model.name],
        value: model,
      })),
    });
    const { picker, header } = search;
    modelSearch = { search, onConnect };
    picker.on("itemSelected", () => {
      const selected = picker.getSelectedOption()?.value as ModelOption | undefined;
      close();
      if (!selected) return;
      if ((selected.variants?.length ?? 0) > 0) showModelVariants(selected, onSelect);
      else onSelect(selected);
    });
    const footer = textNode({
      content: "Type to filter · ↑/↓ select · Enter switch · Ctrl+A connect · Esc closes",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet({ title: "Models", height: sheetHeight(picker.height + listChrome) }, [
        header,
        gap(),
        picker,
        gap(),
        footer,
      ]),
    );
    picker.focus();
  };

  const showProviders = (
    providers: readonly ProviderOption[],
    onSelect: (provider: ProviderOption) => void,
    onBack: () => void,
  ): void => {
    if (view) return;
    const search = createSearchablePicker({
      chrome,
      host,
      height: Math.max(3, Math.min(providers.length, sheetRows() - listChrome)),
      placeholder: "Type to search providers",
      items: providers.map((provider) => ({
        name: provider.name,
        description: provider.connected
          ? "Environment credentials available"
          : provider.env.length > 0
            ? `API key · ${provider.env[0]}`
            : "Uses your cloud credentials",
        fields: [provider.id, provider.name, ...provider.env],
        value: provider,
      })),
    });
    const { picker, header } = search;
    providerCatalog = { search, onBack };
    picker.on("itemSelected", () => {
      const selected = picker.getSelectedOption()?.value as ProviderOption | undefined;
      close();
      if (selected) onSelect(selected);
    });
    const footer = textNode({
      content: "Type to filter · ↑/↓ select · Enter connect · Esc returns to models",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet(
        {
          title: "Connect a provider",
          height: sheetHeight(picker.height + listChrome),
        },
        [header, gap(), picker, gap(), footer],
      ),
    );
    picker.focus();
  };

  const showProviderKey = (
    provider: ProviderOption,
    onSave: (key: string) => void,
    onCancel: () => void,
  ): void => {
    if (view) return;
    const input = textNode({ content: "", width: "100%", height: 1, fg: dimHex });
    const render = (): void => {
      const key = providerForm?.key ?? "";
      input.content = key === "" ? "API key" : "•".repeat(Math.min(48, key.length));
      host.draw();
    };
    providerForm = { provider, key: "", onSave, onCancel, render };
    render();
    const help = textNode({
      content: `Stored in the macOS Keychain · ${provider.env.join(" or ")} remains a fallback`,
      width: "100%",
      wrapMode: "word",
      fg: dimHex,
    });
    const footer = textNode({
      content:
        provider.env.length > 0
          ? "Type API key · Enter save · Empty Enter uses env · Esc cancels"
          : "Type API key · Enter save · Esc cancels",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet({ title: `Connect ${provider.name}`, height: sheetHeight(5) }, [
        input,
        gap(),
        help,
        gap(),
        footer,
      ]),
    );
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
    const modalWidth = columns();
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
                {
                  text: `  ${server.status ?? "active"} · ${server.tools} tools${server.source ? ` · ${server.source}` : ""}`,
                  tone: "muted",
                },
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
      backgroundColor: fillHex,
      contentOptions: { flexDirection: "column" },
    });
    mcpBody = textNode({ content: "", width: "100%", wrapMode: "none" });
    scroll.add(mcpBody);
    render();
    const footer = textNode({
      content: "↑/↓ scroll · r reload · a approve · Esc closes this list",
      width: "100%",
      height: 1,
      fg: dimHex,
    });
    open(
      sheet({ title: "MCP", height: sheetHeight(listHeight + listChrome) }, [
        header,
        gap(),
        scroll,
        gap(),
        footer,
      ]),
    );
    reloadMcp = true;
    mcpApproval = servers.find((server) => server.status === "unapproved")?.name ?? null;
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
    if (providerForm) {
      event.stopPropagation();
      if (event.name === "escape" || (event.ctrl && event.name === "c")) {
        const { onCancel } = providerForm;
        close();
        onCancel();
      } else if (event.name === "return" || event.name === "kpenter") {
        const form = providerForm;
        if (form.key.trim() === "" && form.provider.env.length === 0) return true;
        close();
        form.onSave(form.key);
      } else if (event.name === "backspace") {
        providerForm.key = providerForm.key.slice(0, -1);
        providerForm.render();
      } else if (!event.ctrl && !event.meta && !event.option && event.sequence.length === 1) {
        providerForm.key += event.sequence;
        providerForm.render();
      }
      return true;
    }
    if (modelSearch && event.ctrl && event.name === "a") {
      event.stopPropagation();
      const { onConnect } = modelSearch;
      close();
      onConnect();
      return true;
    }
    if (modelSearch?.search.handleKey(event)) return true;
    if (providerCatalog?.search.handleKey(event)) return true;
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
    } else if (subagentView && event.name === "tab") {
      event.stopPropagation();
      onCycleSubagent();
    } else if (event.name === "escape" || (event.ctrl && event.name === "c")) {
      event.stopPropagation();
      const onBack = providerCatalog?.onBack;
      close();
      onBack?.();
    } else if (reloadSkills && event.name === "r") {
      event.stopPropagation();
      close();
      onSkillsReload();
    } else if (reloadMcp && event.name === "a") {
      event.stopPropagation();
      if (mcpApproval) onMcpApprove(mcpApproval);
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
    showSubagents,
    paintSubagents,
    isSubagentView: () => subagentView !== null,
    showModes,
    showSkills,
    showMcp,
    showModels,
    showProviders,
    showProviderKey,
    showModelError,
    handleKey,
    close,
    isOpen: () => view !== null,
  };
};
