import type {
  AgentCore,
  ExtensionContext,
  ModelProvider,
  SessionRepository,
} from "../../glrs-core/src";
import type { ProviderRegistry } from "../../provider-registry/src";

export type CodingAgentDependencies = {
  runtime: AgentCore;
  sessionRepository: SessionRepository;
  providers: ProviderRegistry;
  extensions?: readonly ((context: ExtensionContext) => void | Promise<void>)[];
  model?: ModelProvider;
};

/** Product composition boundary. The TUI and CLI are adapters around this host. */
export type CodingAgent = AgentCore & {
  dependencies: CodingAgentDependencies;
};

export const createCodingAgent = (dependencies: CodingAgentDependencies): CodingAgent => ({
  ...dependencies.runtime,
  dependencies,
});
