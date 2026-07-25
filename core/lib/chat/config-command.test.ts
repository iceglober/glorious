import { describe, expect, test } from "bun:test";
import type { ChatCommandContext } from "./command-context";
import { runConfigCommand } from "./config-command";

type Notice = { type: string; text?: string };

const makeContext = (over: Partial<ChatCommandContext> = {}): ChatCommandContext =>
  ({ emit: () => {}, ...over }) as unknown as ChatCommandContext;

describe("runConfigCommand", () => {
  test("bare /config prints the usage notice", async () => {
    const notices: Notice[] = [];
    await runConfigCommand(makeContext({ emit: (event) => notices.push(event as Notice) }), "");
    expect(notices[0]?.text).toContain("Usage: /config get|set|delete");
  });

  test("`/config get <path>` still routes to the get handler", async () => {
    const gets: string[] = [];
    const context = makeContext({
      launchConfigTui: async () => {},
      config: {
        get: async ({ key }) => {
          gets.push(key);
          return { ok: true, key, storage: "global_config", value: "x" };
        },
        set: async () => ({ ok: true, key: "", storage: "global_config" }),
        delete: async () => ({ ok: true, key: "", storage: "global_config" }),
      },
    });
    await runConfigCommand(context, "get agent.llm.model");
    expect(gets).toEqual(["agent.llm.model"]);
  });
});
