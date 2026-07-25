import { describe, expect, test } from "bun:test";
import {
  CLAUDE_OAUTH_META_ACCOUNT,
  CLAUDE_OAUTH_TOKEN_ACCOUNT,
  SECRET_SERVICE,
  type SecretStore,
} from "../secrets";
import { parseClaudeAuthorizationInput, runClaudeAuthFlow } from "./auth";

const memoryStore = (): SecretStore & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    get: async (service, account) => values.get(`${service}:${account}`),
    set: async (service, account, value) => void values.set(`${service}:${account}`, value),
    delete: async (service, account) => values.delete(`${service}:${account}`),
  };
};

describe("parseClaudeAuthorizationInput", () => {
  test("splits the code and state returned as CODE#STATE", () => {
    expect(
      parseClaudeAuthorizationInput("code-from-browser#returned-state", "expected-state"),
    ).toEqual({
      code: "code-from-browser",
      state: "returned-state",
    });
  });

  test("reads state from a callback URL fragment", () => {
    expect(
      parseClaudeAuthorizationInput(
        "http://127.0.0.1/callback?code=code-from-browser#returned-state",
        "expected-state",
      ),
    ).toEqual({ code: "code-from-browser", state: "returned-state" });
  });
});

describe("runClaudeAuthFlow", () => {
  test("builds the PKCE authorization request, exchanges the callback, and stores credentials", async () => {
    const store = memoryStore();
    let authorizationUrl: URL | undefined;
    let requestBody: Record<string, string> | undefined;
    const result = await runClaudeAuthFlow({
      store,
      openBrowser: async (url) => {
        authorizationUrl = url;
        return true;
      },
      readAuthorizationCode: async () => {
        if (!authorizationUrl) throw new Error("authorization URL was not opened");
        return `one-time-code#${authorizationUrl.searchParams.get("state")}`;
      },
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            access_token: "sk-ant-oat01-access",
            refresh_token: "sk-ant-ort01-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      randomBytes: (length) => new Uint8Array(length).fill(7),
    });

    expect(result).toEqual({ ok: true });
    expect(authorizationUrl?.searchParams.get("code")).toBe("true");
    expect(authorizationUrl?.searchParams.get("redirect_uri")).toBe(
      "https://platform.claude.com/oauth/code/callback",
    );
    expect(authorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl?.searchParams.get("scope")).toContain("user:profile");
    expect(requestBody?.grant_type).toBe("authorization_code");
    expect(requestBody?.code_verifier).toBeTruthy();
    expect(store.values.get(`${SECRET_SERVICE}:${CLAUDE_OAUTH_TOKEN_ACCOUNT}`)).toBe(
      "sk-ant-oat01-access",
    );
    expect(store.values.get(`${SECRET_SERVICE}:${CLAUDE_OAUTH_META_ACCOUNT}`)).toContain(
      "sk-ant-ort01-refresh",
    );
  });

  test("rejects a callback with the wrong state without exchanging or storing credentials", async () => {
    const store = memoryStore();
    let exchanged = false;
    const result = await runClaudeAuthFlow({
      store,
      openBrowser: async () => true,
      readAuthorizationCode: async () => "http://127.0.0.1/callback?code=x&state=wrong",
      fetch: async () => {
        exchanged = true;
        return new Response("{}", { status: 200 });
      },
    });

    expect(result).toEqual({ ok: false, reason: "authorization state mismatch" });
    expect(exchanged).toBe(false);
    expect(store.values.size).toBe(0);
  });
});
