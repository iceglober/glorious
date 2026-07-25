import { openInBrowser } from "../mcp/oauth";
import {
  CLAUDE_OAUTH_AUTHORIZE_URL,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_OAUTH_META_ACCOUNT,
  CLAUDE_OAUTH_REDIRECT_URI,
  CLAUDE_OAUTH_SCOPE,
  CLAUDE_OAUTH_TOKEN_ACCOUNT,
  CLAUDE_OAUTH_TOKEN_URL,
  SECRET_SERVICE,
  type SecretStore,
} from "../secrets";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ClaudeAuthFlowOptions {
  store: SecretStore;
  /** The callback URL or code copied from the browser address bar. */
  readAuthorizationCode: () => Promise<string | null>;
  openBrowser?: (url: URL) => Promise<boolean>;
  onAuthorizationUrl?: (url: string) => void;
  fetch?: FetchLike;
  authorizeUrl?: string;
  tokenUrl?: string;
  /** Override the hosted callback for a separately registered OAuth client. */
  redirectUri?: string;
  clientId?: string;
  scope?: string;
  signal?: AbortSignal;
  randomBytes?: (length: number) => Uint8Array;
}

export type ClaudeAuthResult = { ok: true } | { ok: false; reason: string };

const base64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const sha256 = async (value: string): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
};

/** Accept the code, `CODE#STATE`, or the complete callback URL. */
export const parseClaudeAuthorizationInput = (
  input: string,
  expectedState: string,
): { code?: string; state?: string; error?: string } => {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : undefined;
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? fragment,
      error: url.searchParams.get("error") ?? undefined,
    };
  } catch {
    const separator = trimmed.indexOf("#");
    if (separator >= 0) {
      return {
        code: trimmed.slice(0, separator) || undefined,
        state: trimmed.slice(separator + 1) || undefined,
      };
    }
    return { code: trimmed || undefined, state: expectedState };
  }
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface ClaudeAuthContext {
  url: string;
  state: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}

export async function generateClaudeAuthRequest(
  options: Partial<ClaudeAuthFlowOptions> = {},
): Promise<ClaudeAuthContext> {
  const bytes = options.randomBytes ?? randomBytes;
  const verifier = base64Url(bytes(32));
  const challenge = base64Url(await sha256(verifier));
  const state = base64Url(bytes(32));
  const redirectUri = options.redirectUri ?? CLAUDE_OAUTH_REDIRECT_URI;
  const clientId = options.clientId ?? CLAUDE_OAUTH_CLIENT_ID;

  const authorizationUrl = new URL(options.authorizeUrl ?? CLAUDE_OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("code", "true");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", options.scope ?? CLAUDE_OAUTH_SCOPE);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);

  return {
    url: authorizationUrl.toString(),
    state,
    verifier,
    clientId,
    redirectUri,
  };
}

export async function exchangeClaudeAuthCode(
  context: ClaudeAuthContext,
  code: string,
  store: SecretStore,
  fetchLike?: FetchLike,
): Promise<ClaudeAuthResult> {
  try {
    const response = await (fetchLike ?? fetch)(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        state: context.state,
        client_id: context.clientId,
        redirect_uri: context.redirectUri,
        code_verifier: context.verifier,
      }),
    });
    if (!response.ok)
      return { ok: false, reason: `token exchange failed (HTTP ${response.status})` };

    const payload = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof payload.access_token !== "string" ||
      payload.access_token.length === 0 ||
      typeof payload.refresh_token !== "string" ||
      payload.refresh_token.length === 0
    ) {
      return { ok: false, reason: "token exchange returned incomplete credentials" };
    }
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 28_800;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      return { ok: false, reason: "token exchange returned an invalid expiry" };
    }

    await store.set(SECRET_SERVICE, CLAUDE_OAUTH_TOKEN_ACCOUNT, payload.access_token);
    await store.set(
      SECRET_SERVICE,
      CLAUDE_OAUTH_META_ACCOUNT,
      JSON.stringify({
        refreshToken: payload.refresh_token,
        expiresAt: Date.now() + expiresIn * 1000,
      }),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

/**
 * Claude OAuth flow opens the browser authorization page and redirects to the manual
 * callback URL (https://platform.claude.com/oauth/code/callback). The user pastes
 * the resulting callback URL, authorization code, or CODE#STATE back into the CLI.
 */
export async function runClaudeAuthFlow(options: ClaudeAuthFlowOptions): Promise<ClaudeAuthResult> {
  try {
    const context = await generateClaudeAuthRequest(options);
    options.onAuthorizationUrl?.(context.url);
    await (options.openBrowser ?? ((url) => openInBrowser(url)))(new URL(context.url));
    const input = await options.readAuthorizationCode();
    if (!input || options.signal?.aborted)
      return { ok: false, reason: "authorization cancelled or timed out" };
    const parsed = parseClaudeAuthorizationInput(input, context.state);
    if (parsed.error) return { ok: false, reason: `authorization failed: ${parsed.error}` };
    if (!parsed.code) return { ok: false, reason: "authorization callback carried no code" };
    if (parsed.state !== context.state)
      return { ok: false, reason: "authorization state mismatch" };

    return await exchangeClaudeAuthCode(context, parsed.code, options.store, options.fetch);
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}
