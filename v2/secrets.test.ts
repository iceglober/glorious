import { describe, expect, test } from "bun:test";
import { createProviderKeyStore } from "./secrets";

describe("provider key store", () => {
  test("reads each provider from Keychain only once", async () => {
    const calls: string[][] = [];
    const store = createProviderKeyStore(async (args) => {
      calls.push(args);
      return "key";
    });

    expect(await store.get("openai")).toBe("key");
    expect(await store.get("openai")).toBe("key");
    expect(calls).toEqual([
      ["find-generic-password", "-a", "openai-api-key", "-s", "glorious", "-w"],
    ]);
  });

  test("uses the newly saved key without another Keychain read", async () => {
    const calls: string[][] = [];
    const store = createProviderKeyStore(async (args) => {
      calls.push(args);
      return "";
    });

    await store.save("anthropic", "new-key");
    expect(await store.get("anthropic")).toBe("new-key");
    expect(calls).toEqual([
      ["add-generic-password", "-U", "-a", "anthropic-api-key", "-s", "glorious", "-w", "new-key"],
    ]);
  });
});
