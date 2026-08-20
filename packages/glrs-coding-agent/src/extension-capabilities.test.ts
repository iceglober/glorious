import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const core = readFileSync(
  join(import.meta.dir, "..", "..", "glrs-core", "src", "index.ts"),
  "utf8",
);

const block = (start: string): string => {
  const from = core.indexOf(start);
  if (from < 0) return "";
  const body = core.slice(from);
  return body.slice(0, body.indexOf("\n};"));
};

const members = (start: string): Set<string> =>
  new Set(
    [...block(start).matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gmu)].map((match) => match[1]),
  );

const api = members("export type Glrs = {");
const ui = members("export type Ui = {");
const events = new Set(
  [...block("export type EventName =").matchAll(/"([a-z_]+)"/gu)].map((match) => match[1]),
);

type Requirement = {
  example: string;
  api?: string[];
  ui?: string[];
  events?: string[];
  tool?: string[];
};

const requirements: Requirement[] = [
  { example: "hello", api: ["tool"] },
  { example: "question", api: ["tool"], ui: ["capture"] },
  { example: "questionnaire", api: ["tool"], ui: ["mount"] },
  { example: "todo", api: ["tool", "appendEntry", "entries", "messageRenderer"] },
  { example: "dynamic-tools", api: ["tool", "command"], events: ["session_start"] },
  { example: "structured-output", api: ["tool"], tool: ["terminate"] },
  { example: "truncated-tool", api: ["tool", "truncateHead"] },
  { example: "tool-override", api: ["tool"] },
  { example: "pirate", api: ["command", "prompt"], events: ["before_agent_start"] },
  { example: "summarize", api: ["command", "history"], ui: ["mount"] },
  { example: "handoff", api: ["command", "setModel", "history"], ui: ["mount", "setInput"] },
  { example: "qna", api: ["command"], ui: ["mount", "setInput"] },
  { example: "send-user-message", api: ["command", "send"] },
  { example: "reload-runtime", api: ["command", "reload", "send"] },
  { example: "shutdown-command", api: ["command", "shutdown"] },
  { example: "permission-gate", events: ["tool_call"], ui: ["mount"] },
  { example: "project-trust", events: ["project_trust"], ui: ["mount"] },
  { example: "protected-paths", events: ["tool_call"] },
  { example: "confirm-destructive", events: ["session_before_switch", "session_before_fork"] },
  {
    example: "dirty-repo-guard",
    api: ["exec"],
    events: ["session_before_switch", "session_before_fork"],
  },
  { example: "input-transform", events: ["input"] },
  { example: "input-transform-streaming", events: ["input"] },
  { example: "model-status", api: ["status"], events: ["model_select"] },
  { example: "provider-payload", events: ["before_provider_request", "after_provider_response"] },
  { example: "system-prompt-header", api: ["systemPrompt"], events: ["agent_start"] },
  { example: "claude-rules", api: ["prompt"], events: ["session_start", "before_agent_start"] },
  { example: "prompt-customizer", api: ["prompt"], events: ["before_agent_start"] },
  { example: "file-trigger", api: ["send"] },
  { example: "custom-compaction", api: ["history"], events: ["session_before_compact"] },
  { example: "trigger-compact", api: ["compact"] },
  { example: "git-checkpoint", api: ["exec"], events: ["turn_start", "session_before_fork"] },
  { example: "git-merge-and-resolve", api: ["exec", "send"], events: ["agent_end"] },
  { example: "auto-commit-on-exit", api: ["exec"], events: ["session_shutdown"] },
  { example: "status-line", api: ["status"] },
  { example: "working-indicator", api: ["activity", "command"] },
  {
    example: "github-issue-autocomplete",
    api: ["autocomplete", "exec"],
    events: ["session_start"],
  },
  { example: "custom-footer", api: ["command"], ui: ["mount"] },
  { example: "custom-header", ui: ["mount"], events: ["session_start"] },
  { example: "modal-editor", ui: ["mount"] },
  { example: "rainbow-editor", ui: ["mount"] },
  { example: "widget-placement", ui: ["mount"] },
  { example: "overlay-test", ui: ["mount"] },
  { example: "overlay-qa-tests", ui: ["mount"] },
  { example: "notify", ui: ["notify"] },
  { example: "timed-confirm", ui: ["mount"] },
  { example: "mac-system-theme", api: ["exec"], ui: ["setTheme"] },
  { example: "plan-mode", api: ["command", "key", "flag", "status", "filterTools", "send"] },
  {
    example: "preset",
    api: ["command", "key", "flag", "setModel", "setThinkingLevel", "appendEntry"],
  },
  { example: "tools", api: ["command", "filterTools"] },
  { example: "ssh", api: ["flag", "exec"], events: ["user_bash", "before_agent_start"] },
  { example: "interactive-shell", events: ["user_bash"] },
  { example: "sandbox", api: ["tool"], events: ["user_bash"] },
  { example: "gondolin", api: ["tool"], events: ["user_bash"] },
  { example: "subagent", api: ["tool", "exec"] },
  { example: "snake", api: ["command"], ui: ["mount"] },
  { example: "space-invaders", api: ["command"], ui: ["mount"] },
  { example: "doom-overlay", ui: ["mount"] },
  { example: "custom-provider-anthropic", api: ["provider"] },
  { example: "custom-provider-gitlab-duo", api: ["provider"] },
  { example: "message-renderer", api: ["messageRenderer", "send"] },
  { example: "entry-renderer", api: ["entryRenderer", "appendEntry"] },
  { example: "event-bus", api: ["events"] },
  { example: "session-name", api: ["setSessionName", "session"] },
  { example: "bookmark", api: ["setLabel"] },
  { example: "inline-bash", events: ["tool_call"] },
  { example: "bash-spawn-hook", events: ["user_bash"] },
  { example: "with-deps", api: ["tool"] },
];

describe("extension capability contract", () => {
  for (const requirement of requirements) {
    test(`${requirement.example} can be implemented without changing glrs`, () => {
      expect(requirement.api?.filter((name) => !api.has(name)) ?? []).toEqual([]);
      expect(requirement.ui?.filter((name) => !ui.has(name)) ?? []).toEqual([]);
      expect(requirement.events?.filter((name) => !events.has(name)) ?? []).toEqual([]);
      for (const member of requirement.tool ?? [])
        expect(block("export type ToolSpec")).toContain(member);
    });
  }

  test("the reference matrix stays complete", () => {
    expect(requirements).toHaveLength(67);
  });
});
