/**
 * Cloud-auth detection for the keyless providers (Bedrock, Vertex). These don't
 * take an API key — they read the ambient AWS / GCP credential chain. This
 * module reports, without shelling out, whether those credentials are already
 * present, whether the vendor CLI is installed, and the exact login command to
 * establish them — so the config TUI can guide (and optionally run) setup.
 */
/** The state of a cloud provider's live session: usable, needs re-auth, or no
 *  credentials at all. */
export type CloudSessionResult = "valid" | "stale" | "missing";

/** The providers that authenticate via a cloud credential chain, not a key. */
export const CLOUD_AUTH_PROVIDERS = ["bedrock", "vertex"] as const;
export type CloudAuthProvider = (typeof CLOUD_AUTH_PROVIDERS)[number];

export const isCloudAuthProvider = (name: string): name is CloudAuthProvider =>
  (CLOUD_AUTH_PROVIDERS as readonly string[]).includes(name);

/** One editable, non-secret setup parameter (e.g. Vertex project, Bedrock region). */
export interface CloudAuthParam {
  /** Config key under `agent.llm.providers.<provider>`. */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Placeholder / example value. */
  placeholder: string;
  /** A sensible default sniffed from the environment, if any. */
  value: string;
}

export interface CloudAuthStatus {
  /** Credentials the SDK can use are already reachable. */
  credsPresent: boolean;
  /** The vendor CLI (`aws` / `gcloud`) is on PATH, so we can run the login. */
  cliAvailable: boolean;
  /** The interactive login command, as argv (suspend the TUI, run, resume). */
  loginArgv: string[];
  /** Non-secret params to collect into `agent.llm.providers.<provider>`. */
  params: CloudAuthParam[];
  /** One-line hint about where the ambient credentials come from. */
  detail: string;
}

export interface CloudAuthEnv {
  /** Environment variables (process.env or a test double). */
  env: Record<string, string | undefined>;
  /** Whether a file exists (injected so detection stays pure/testable). */
  fileExists: (path: string) => boolean;
  /** Whether a command resolves on PATH (e.g. `(c) => Bun.which(c) != null`). */
  which: (command: string) => boolean;
  /** The user's home directory, for credential-file paths. */
  home: string;
}

const firstSet = (
  env: Record<string, string | undefined>,
  ...names: string[]
): string | undefined => {
  for (const n of names) {
    const v = env[n];
    if (v?.trim()) return v.trim();
  }
  return undefined;
};

const detectVertex = (deps: CloudAuthEnv): CloudAuthStatus => {
  const { env, fileExists, which, home } = deps;
  // Application Default Credentials: an explicit key file, or the well-known
  // ADC file that `gcloud auth application-default login` writes.
  const adcFile = `${home}/.config/gcloud/application_default_credentials.json`;
  const credsPresent =
    Boolean(firstSet(env, "GOOGLE_APPLICATION_CREDENTIALS")) || fileExists(adcFile);
  return {
    credsPresent,
    cliAvailable: which("gcloud"),
    loginArgv: ["gcloud", "auth", "application-default", "login"],
    detail: "Vertex uses Google Application Default Credentials (ADC).",
    params: [
      {
        key: "project",
        label: "project",
        placeholder: "my-gcp-project",
        value:
          firstSet(env, "GOOGLE_CLOUD_PROJECT", "GOOGLE_VERTEX_PROJECT", "GCLOUD_PROJECT") ?? "",
      },
      {
        // `global` serves the newest Gemini models; regional endpoints (e.g.
        // us-central1) only carry a subset, so default to global.
        key: "location",
        label: "location",
        placeholder: "global",
        value: firstSet(env, "GOOGLE_VERTEX_LOCATION", "GOOGLE_CLOUD_REGION") ?? "global",
      },
    ],
  };
};

const detectBedrock = (deps: CloudAuthEnv): CloudAuthStatus => {
  const { env, fileExists, which, home } = deps;
  // Any credential source the AWS SDK's default chain would find: static keys, a
  // Bedrock bearer token, a named profile, container/ECS or web-identity creds,
  // or the shared credentials file the AWS CLI maintains.
  const credsPresent =
    (Boolean(firstSet(env, "AWS_ACCESS_KEY_ID")) &&
      Boolean(firstSet(env, "AWS_SECRET_ACCESS_KEY"))) ||
    Boolean(firstSet(env, "AWS_BEARER_TOKEN_BEDROCK")) ||
    Boolean(firstSet(env, "AWS_PROFILE")) ||
    Boolean(
      firstSet(
        env,
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
      ),
    ) ||
    fileExists(`${home}/.aws/credentials`);
  const profile = firstSet(env, "AWS_PROFILE");
  return {
    credsPresent,
    cliAvailable: which("aws"),
    // SSO is the common browser-based login; scope it to the active profile.
    loginArgv: profile ? ["aws", "sso", "login", "--profile", profile] : ["aws", "sso", "login"],
    detail: "Bedrock uses the AWS credential chain (env keys, SSO, or a profile).",
    params: [
      {
        key: "region",
        label: "region",
        placeholder: "us-east-1",
        value: firstSet(env, "AWS_REGION", "AWS_DEFAULT_REGION") ?? "us-east-1",
      },
    ],
  };
};

/** Report the ambient cloud-auth state for a keyless provider. */
export const detectCloudAuth = (
  provider: CloudAuthProvider,
  deps: CloudAuthEnv,
): CloudAuthStatus => (provider === "vertex" ? detectVertex(deps) : detectBedrock(deps));

/**
 * Turn an opaque provider error into a one-line, actionable message. Cloud
 * providers surface raw vendor JSON (a Google OAuth `invalid_rapt` blob, a
 * "model not found in region" wall of text) that says nothing about the fix;
 * recognize the common cases and say what to run. Returns undefined when it
 * isn't a recognized case, so the caller keeps the original message.
 */
export const describeAuthError = (message: string): string | undefined => {
  const m = message.toLowerCase();
  // Google ADC needs re-auth: expired session or an org reauth policy.
  if (m.includes("invalid_rapt") || (m.includes("invalid_grant") && m.includes("reauth"))) {
    return "Vertex credentials need re-authentication. Run: gcloud auth application-default login (or in `glorious config`, pick Vertex → run login).";
  }
  // AWS SSO session expired.
  if (m.includes("sso") && (m.includes("expired") || m.includes("token has expired"))) {
    return "Bedrock's AWS SSO session expired. Run: aws sso login (or in `glorious config`, pick Bedrock → run login).";
  }
  // Vertex model isn't served from the configured location (or no access). The
  // newest Gemini models live at `global`, not regional endpoints.
  if (
    m.includes("publisher model") &&
    (m.includes("was not found") || m.includes("does not have access"))
  ) {
    const loc = message.match(/locations\/([^/]+)\//)?.[1];
    const model = message.match(/models\/([^/`'"\s]+)/)?.[1];
    const where = loc ? ` in location "${loc}"` : "";
    const fix =
      loc && loc !== "global"
        ? ` The newest Gemini models are served from "global" — set it: glorious config set agent.llm.providers.vertex.location global`
        : " Check the model id and that your project has access to it.";
    return `Vertex model${model ? ` "${model}"` : ""} isn't available${where}.${fix}`;
  }
  return undefined;
};
