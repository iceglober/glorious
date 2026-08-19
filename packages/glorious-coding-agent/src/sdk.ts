/** @module SDK */

import type {
  AgentCore,
  ModelProvider,
  SessionRepository,
} from "../../glorious-core/src";
import type { ProviderRegistry } from "../../provider-registry/src";
import type { Extension } from "./public-extension-api";

export {
  createAgentCore,
  jsonSessionRepository,
} from "../../glorious-core/src";
export type {
  AgentCore,
  ModelProvider,
  Session,
  SessionEvent,
  SessionRepository,
  Turn,
} from "../../glorious-core/src";
export { createProviderRegistry } from "../../provider-registry/src";
export type {
  ProviderAdapter,
  ProviderRegistry,
} from "../../provider-registry/src";
export type { Extension } from "./public-extension-api";

export type CodingAgentDependencies = {
  runtime: AgentCore;
  sessionRepository: SessionRepository;
  providers: ProviderRegistry;
  extensions?: readonly Extension[];
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
