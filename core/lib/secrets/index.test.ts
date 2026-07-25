import { describe, expect, mock, test } from "bun:test";
import {
  AZURE_API_KEY_ACCOUNT,
  AZURE_SECRET_SERVICE,
  CLAUDE_OAUTH_META_ACCOUNT,
  CLAUDE_OAUTH_TOKEN_ACCOUNT,
  resolveAzureApiKey,
  resolveProviderKey,
  SECRET_SERVICE,
  type SecretStore,
  SecretStoreUnavailableError,
} from "./index";

const fixtureSecret = "fixture-secret-must-not-leak";

function makeStore(get: SecretStore["get"]): SecretStore {
  return {
    get,
    set: async () => {},
    delete: async () => false,
  };
}

describe("resolveProviderKey", () => {
  test("refreshes an expiring Claude OAuth token and persists rotated credentials", async () => {
    const values = new Map([
      [`${SECRET_SERVICE}:${CLAUDE_OAUTH_TOKEN_ACCOUNT}`, "sk-ant-oat01-old"],
      [
        `${SECRET_SERVICE}:${CLAUDE_OAUTH_META_ACCOUNT}`,
        JSON.stringify({ refreshToken: "sk-ant-ort01-old", expiresAt: 900_000 }),
      ],
    ]);
    const store: SecretStore = {
      get: async (service, account) => values.get(`${service}:${account}`),
      set: async (service, account, value) => void values.set(`${service}:${account}`, value),
      delete: async () => false,
    };
    let body: Record<string, string> | undefined;
    const resolved = await resolveProviderKey("claude", store, {
      now: () => 1_000_000,
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            access_token: "sk-ant-oat01-new",
            refresh_token: "sk-ant-ort01-new",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      },
    });

    expect(resolved).toBe("sk-ant-oat01-new");
    expect(body).toEqual({
      grant_type: "refresh_token",
      refresh_token: "sk-ant-ort01-old",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    });
    expect(values.get(`${SECRET_SERVICE}:${CLAUDE_OAUTH_TOKEN_ACCOUNT}`)).toBe("sk-ant-oat01-new");
    expect(values.get(`${SECRET_SERVICE}:${CLAUDE_OAUTH_META_ACCOUNT}`)).toContain(
      "sk-ant-ort01-new",
    );
  });

  test("leaves API keys and non-expiring OAuth tokens untouched", async () => {
    const get = mock<SecretStore["get"]>();
    get.mockResolvedValue("sk-ant-api01-key");
    const store = makeStore(get);
    await expect(resolveProviderKey("anthropic", store)).resolves.toBe("sk-ant-api01-key");
    await expect(resolveProviderKey("openai", store)).resolves.toBe("sk-ant-api01-key");
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("resolveAzureApiKey", () => {
  test("prefers Foundry then Azure environment credentials without reading the store", async () => {
    const get = mock<SecretStore["get"]>();
    const store = makeStore(get);

    await expect(
      resolveAzureApiKey({
        env: {
          AZURE_FOUNDRY_API_KEY: "foundry-key",
          AZURE_API_KEY: "azure-key",
        },
        store,
      }),
    ).resolves.toEqual({
      status: "resolved",
      apiKey: "foundry-key",
      source: "azure-foundry-api-key",
    });

    await expect(
      resolveAzureApiKey({ env: { AZURE_API_KEY: "azure-key" }, store }),
    ).resolves.toEqual({
      status: "resolved",
      apiKey: "azure-key",
      source: "azure-api-key",
    });

    expect(get).not.toHaveBeenCalled();
  });

  test("resolves the Azure key from the fixed keychain service and account", async () => {
    const get = mock<SecretStore["get"]>();
    get.mockResolvedValue("stored-key");

    await expect(resolveAzureApiKey({ env: {}, store: makeStore(get) })).resolves.toEqual({
      status: "resolved",
      apiKey: "stored-key",
      source: "secret-store",
    });

    expect(AZURE_SECRET_SERVICE).toBe("glorious");
    expect(AZURE_API_KEY_ACCOUNT).toBe("azure-api-key");
    expect(get).toHaveBeenCalledWith(AZURE_SECRET_SERVICE, AZURE_API_KEY_ACCOUNT);
  });

  test("reports a missing key without including a fixture secret in the status", async () => {
    const get = mock<SecretStore["get"]>();
    get.mockResolvedValue(undefined);

    const result = await resolveAzureApiKey({ env: {}, store: makeStore(get) });

    expect(result).toEqual({ status: "missing" });
    expect(JSON.stringify(result)).not.toContain(fixtureSecret);
  });

  test("redacts unavailable store errors and never includes a fixture secret", async () => {
    const unavailableStore = makeStore(async () => {
      throw new Error(`native keychain error: ${fixtureSecret}`);
    });

    const result = await resolveAzureApiKey({ env: {}, store: unavailableStore });

    expect(result.status).toBe("store-unavailable");
    if (result.status !== "store-unavailable") throw new Error("Expected unavailable store");
    expect(result.error).toBeInstanceOf(SecretStoreUnavailableError);
    expect(result.error).toMatchObject({
      name: "SecretStoreUnavailableError",
      message: "The secure secret store is unavailable.",
    });
    expect(JSON.stringify(result)).not.toContain(fixtureSecret);
    expect(String(result.error)).not.toContain(fixtureSecret);
  });

  test("reports a missing store as unavailable without exposing a secret", async () => {
    const result = await resolveAzureApiKey({ env: {} });

    expect(result.status).toBe("store-unavailable");
    expect(JSON.stringify(result)).not.toContain(fixtureSecret);
  });
});
