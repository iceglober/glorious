// The providers glorious knows without being told: what each is called, which
// environment variables carry its credentials, and what else it needs before it
// can answer.
//
// This is the table `doctor` reads to say what is missing, and the table
// credential resolution walks. Each provider's SDK has its own default variable
// and would find it unaided — but then glorious cannot tell you *why* a session
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

export const PROVIDERS: readonly ProviderSpec[] = [
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
    note: "Authenticates with ADC — `gcloud auth application-default login` is usually enough.",
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
];

const byId = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export const providerSpec = (id: string): ProviderSpec | undefined => byId.get(id);

// Any id glorious does not know is treated as an OpenAI-compatible endpoint,
// which is what makes Ollama, LM Studio, vLLM, a gateway or a company proxy
// reachable without glorious shipping a factory for each. It needs a base URL,
// because there is nothing else to guess from.
export const compatibleNote =
  'Unknown providers are treated as OpenAI-compatible. Give one a base URL: {"providers":{"<id>":{"api":"http://localhost:11434/v1"}}}';

// What is missing before this provider can answer, for `doctor`.
export const missingFor = (
  id: string,
  settings: { api?: string } | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string[] => {
  const spec = byId.get(id);
  if (!spec)
    return settings?.api
      ? []
      : [`providers.${id}.api (base URL for an OpenAI-compatible endpoint)`];
  const gaps: string[] = [];
  if (spec.env.length > 0 && !spec.env.some((name) => environment[name]))
    gaps.push(spec.env.join(" or "));
  for (const need of spec.needs ?? []) {
    const [first] = need.split(" or ");
    if (!first.includes(".") && !environment[first]) gaps.push(need);
  }
  return gaps;
};
