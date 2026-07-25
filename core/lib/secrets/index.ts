/** Keychain service for all of glorious's secrets. */
export const SECRET_SERVICE = "glorious";
/** The keychain account holding a provider's API key. */
export const providerKeyAccount = (provider: string): string => `${provider}-api-key`;

export const CLAUDE_OAUTH_TOKEN_ACCOUNT = "claude-oauth-token";
export const CLAUDE_OAUTH_META_ACCOUNT = "claude-oauth-meta";
export const CLAUDE_OAUTH_AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
export const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const CLAUDE_OAUTH_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_SCOPE =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const OAUTH_ACCESS_TOKEN_PREFIX = "sk-ant-oat";
const OAUTH_REFRESH_BUFFER_MS = 60_000;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ClaudeOAuthMetadata = { refreshToken: string; expiresAt: number };

const parseClaudeOAuthMetadata = (raw: string | undefined): ClaudeOAuthMetadata | undefined => {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.refreshToken === "string" &&
      typeof value.expiresAt === "number" &&
      Number.isFinite(value.expiresAt)
      ? { refreshToken: value.refreshToken, expiresAt: value.expiresAt }
      : undefined;
  } catch {
    return undefined;
  }
};

const refreshClaudeOAuthToken = async (
  accessToken: string,
  store: SecretStore,
  metadata: ClaudeOAuthMetadata,
  options: { fetch: FetchLike; now: () => number },
): Promise<string> => {
  if (metadata.expiresAt > options.now() + OAUTH_REFRESH_BUFFER_MS) return accessToken;

  const response = await options.fetch(CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: metadata.refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    }),
  });
  if (!response.ok) return accessToken;

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0)
    return accessToken;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 28_800;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return accessToken;

  const nextMetadata = {
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token
        ? payload.refresh_token
        : metadata.refreshToken,
    expiresAt: options.now() + expiresIn * 1000,
  };
  await store.set(SECRET_SERVICE, CLAUDE_OAUTH_TOKEN_ACCOUNT, payload.access_token);
  await store.set(SECRET_SERVICE, CLAUDE_OAUTH_META_ACCOUNT, JSON.stringify(nextMetadata));
  return payload.access_token;
};

export const AZURE_SECRET_SERVICE = SECRET_SERVICE;
export const AZURE_API_KEY_ACCOUNT = providerKeyAccount("azure");

export type AzureApiKeySource = "azure-foundry-api-key" | "azure-api-key" | "secret-store";

export interface SecretStore {
  get(service: string, account: string): Promise<string | undefined>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
}

export class SecretStoreUnavailableError extends Error {
  constructor() {
    super("The secure secret store is unavailable.");
    this.name = "SecretStoreUnavailableError";
  }
}

export type AzureApiKeyResolution =
  | {
      status: "resolved";
      apiKey: string;
      source: AzureApiKeySource;
    }
  | {
      status: "missing";
    }
  | {
      status: "store-unavailable";
      error: SecretStoreUnavailableError;
    };

export interface ResolveAzureApiKeyOptions {
  env?: Record<string, string | undefined>;
  store?: SecretStore;
}

function resolved(apiKey: string, source: AzureApiKeySource): AzureApiKeyResolution {
  return { status: "resolved", apiKey, source };
}

export async function resolveAzureApiKey({
  env = process.env,
  store,
}: ResolveAzureApiKeyOptions = {}): Promise<AzureApiKeyResolution> {
  const foundryApiKey = env.AZURE_FOUNDRY_API_KEY;
  if (foundryApiKey) return resolved(foundryApiKey, "azure-foundry-api-key");

  const azureApiKey = env.AZURE_API_KEY;
  if (azureApiKey) return resolved(azureApiKey, "azure-api-key");

  if (!store) return { status: "store-unavailable", error: new SecretStoreUnavailableError() };

  try {
    const apiKey = await store.get(AZURE_SECRET_SERVICE, AZURE_API_KEY_ACCOUNT);
    return apiKey ? resolved(apiKey, "secret-store") : { status: "missing" };
  } catch {
    return { status: "store-unavailable", error: new SecretStoreUnavailableError() };
  }
}

export async function hasAzureApiKey(options?: ResolveAzureApiKeyOptions): Promise<boolean> {
  return (await resolveAzureApiKey(options)).status === "resolved";
}

/**
 * A provider's API key from the keychain (`<provider>-api-key`). The AI SDK
 * reads each provider's own env var when this is absent, so a missing key is
 * not an error here — the caller only injects a key it actually found.
 */
export async function resolveProviderKey(
  provider: string,
  store?: SecretStore,
  options: { fetch?: FetchLike; now?: () => number } = {},
): Promise<string | undefined> {
  if (!store) return undefined;
  try {
    const account =
      provider === "claude" ? CLAUDE_OAUTH_TOKEN_ACCOUNT : providerKeyAccount(provider);
    let accessToken = await store.get(SECRET_SERVICE, account);
    if (provider === "claude" && !accessToken) {
      accessToken = await store.get(SECRET_SERVICE, providerKeyAccount("claude"));
    }
    if (provider !== "claude" || !accessToken?.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
      return accessToken;
    }
    const metadata = parseClaudeOAuthMetadata(
      await store.get(SECRET_SERVICE, CLAUDE_OAUTH_META_ACCOUNT),
    );
    if (!metadata) return accessToken;
    try {
      return await refreshClaudeOAuthToken(accessToken, store, metadata, {
        fetch: options.fetch ?? fetch,
        now: options.now ?? Date.now,
      });
    } catch {
      // A transient refresh failure should not erase a still-usable token.
      return accessToken;
    }
  } catch {
    return undefined;
  }
}

/** Whether a provider has a key in the keychain. */
export async function hasProviderKey(provider: string, store?: SecretStore): Promise<boolean> {
  return Boolean(await resolveProviderKey(provider, store));
}
