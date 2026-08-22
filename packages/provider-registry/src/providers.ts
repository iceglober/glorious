// The providers glrs knows without being told: what each is called, which
// environment variables carry its credentials, and what else it needs before it
// can answer.
//
// This is the table `doctor` reads to say what is missing, and the table
// credential resolution walks. Each provider's SDK has its own default variable
// and would find it unaided — but then glrs cannot tell you *why* a session
// will not start, and cannot accept the second and third names a provider
// answers to. Azure answers to three.
//
// Anything not listed here still works if it speaks an OpenAI-compatible API:
// give it a base URL in config and it is routed there. See `compatible` below.

export type ProviderSpec = {
  id: string;
  label: string;
  /** Credential variables, in precedence order. Empty means the SDK's own. */
  env: readonly string[];
  /** Other variables or config keys required before a call can be made. */
  needs?: readonly string[];
  /** How to reach it, when it is not one of the named SDKs. */
  note?: string;
};

const PROVIDER_DEFINITIONS = [
  {
    id: "anthropic",
    label: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "openai",
    label: "OpenAI",
    env: ["OPENAI_API_KEY"],
  },
  {
    id: "azure",
    label: "Azure OpenAI / AI Foundry",
    // Foundry and OpenAI-on-Azure are the same deployment surface here, and
    // between the portal, the CLI and the SDK all three names are in the wild.
    env: ["AZURE_FOUNDRY_API_KEY", "AZURE_API_KEY", "AZURE_OPENAI_API_KEY"],
    needs: ["AZURE_RESOURCE_NAME"],
  },
  {
    id: "google",
    label: "Google Gemini",
    env: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  },
  {
    id: "google-vertex",
    label: "Google Vertex AI",
    // Application Default Credentials, not an API key.
    env: ["GOOGLE_APPLICATION_CREDENTIALS"],
    needs: ["GOOGLE_CLOUD_PROJECT or providers.google-vertex.project"],
    note: "Authenticates with ADC, `gcloud auth application-default login` is usually enough.",
  },
  {
    id: "amazon-bedrock",
    label: "Amazon Bedrock",
    env: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK"],
    needs: ["AWS_REGION or providers.amazon-bedrock.region"],
    note: "Uses the standard AWS credential chain, so an assumed role or SSO profile works.",
  },
  { id: "openrouter", label: "OpenRouter", env: ["OPENROUTER_API_KEY"] },
  { id: "groq", label: "Groq", env: ["GROQ_API_KEY"] },
  { id: "mistral", label: "Mistral", env: ["MISTRAL_API_KEY"] },
  { id: "deepseek", label: "DeepSeek", env: ["DEEPSEEK_API_KEY"] },
  { id: "cerebras", label: "Cerebras", env: ["CEREBRAS_API_KEY"] },
  { id: "cohere", label: "Cohere", env: ["COHERE_API_KEY"] },
  { id: "xai", label: "xAI", env: ["XAI_API_KEY"] },
  { id: "perplexity", label: "Perplexity", env: ["PERPLEXITY_API_KEY"] },
  { id: "togetherai", label: "Together AI", env: ["TOGETHER_AI_API_KEY"] },
] as const satisfies readonly ProviderSpec[];

export type BuiltinProviderId = (typeof PROVIDER_DEFINITIONS)[number]["id"];
export const PROVIDERS: readonly ProviderSpec[] = PROVIDER_DEFINITIONS;

const byId = new Map<string, ProviderSpec>(PROVIDERS.map((provider) => [provider.id, provider]));

// What people actually type. The canonical ids follow the SDK packages, which
// is why Vertex is `google-vertex` and Bedrock is `amazon-bedrock` — reasonable
// as identifiers, not what anyone reaches for. An alias that resolves is worth
// more than an error that is technically correct.
export const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  vertex: "google-vertex",
  "google-vertex-ai": "google-vertex",
  gemini: "google",
  "google-ai": "google",
  bedrock: "amazon-bedrock",
  aws: "amazon-bedrock",
  claude: "anthropic",
  "azure-openai": "azure",
  "azure-ai": "azure",
  foundry: "azure",
  together: "togetherai",
  "together-ai": "togetherai",
  grok: "xai",
  "open-router": "openrouter",
};

export const PROVIDER_SETTINGS: Record<string, readonly string[]> = {
  "amazon-bedrock": ["api", "region"],
  "google-vertex": ["api", "project", "location"],
};

export const settingsFor = (provider: string): readonly string[] =>
  PROVIDER_SETTINGS[provider] ?? ["api"];

export const canonicalProvider = (id: string): string => PROVIDER_ALIASES[id] ?? id;

export const providerSpec = (id: string): ProviderSpec | undefined =>
  byId.get(canonicalProvider(id));

// An unknown id that is nearly a known one is almost always a near-miss rather
// than a local endpoint. Saying which beats telling someone to configure a base
// URL for a provider that ships built in.
export const nearestProvider = (id: string): string | undefined => {
  if (byId.has(canonicalProvider(id))) return undefined;
  const lower = id.toLowerCase();
  return PROVIDERS.map((provider) => provider.id).find(
    (known) => known.includes(lower) || lower.includes(known.split("-").pop() ?? known),
  );
};

// Any id glrs does not know is treated as an OpenAI-compatible endpoint,
// which is what makes Ollama, LM Studio, vLLM, a gateway or a company proxy
// reachable without glrs shipping a factory for each. It needs a base URL,
// because there is nothing else to guess from.
//
// Written once. This sentence used to exist three times — here, inline in
// `missingFor`, and a third time in `createModel` — and the copy here was the
// one nothing referenced.
export const compatibleNote = (id: string): string =>
  `providers.${id}.api (base URL for an OpenAI-compatible endpoint)`;

// What a provider wants said beyond the name of a variable: how to obtain the
// credential, when it is not simply "set this". Carried on the spec for vertex
// and bedrock and read by nothing, so doctor reported that a credential was
// missing without saying how to supply it.
export const noteFor = (id: string): string | undefined => providerSpec(id)?.note;

// What is missing before this provider can answer, for `doctor`.
export const missingFor = (
  id: string,
  settings:
    | {
        api?: string;
        credential?: "keychain";
        factoryOptions?: { apiKey?: unknown; baseURL?: unknown; resourceName?: unknown };
      }
    | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string[] => {
  const spec = providerSpec(id);
  if (!spec) {
    if (settings?.api || typeof settings?.factoryOptions?.baseURL === "string") return [];
    const near = nearestProvider(id);
    return [
      near === undefined
        ? compatibleNote(id)
        : `unknown provider "${id}", did you mean "${near}"? Otherwise set providers.${id}.api ` +
          "for an OpenAI-compatible endpoint",
    ];
  }
  const gaps: string[] = [];
  const hasCredential =
    settings?.credential === "keychain" ||
    typeof settings?.factoryOptions?.apiKey === "string" ||
    spec.env.some((name) => Boolean(environment[name]));
  if (spec.env.length > 0 && !hasCredential) gaps.push(spec.env.join(" or "));
  for (const need of spec.needs ?? []) {
    const [first] = need.split(" or ");
    const configuredAzureResource =
      id === "azure" &&
      Boolean(
        settings?.api ||
          settings?.factoryOptions?.baseURL ||
          settings?.factoryOptions?.resourceName,
      );
    if (!first.includes(".") && !environment[first] && !configuredAzureResource) gaps.push(need);
  }
  return gaps;
};
