/**
 * Compose the provider-neutral core into another host.
 *
 * Most users need the `glrs` CLI, not this module. Use the SDK when embedding
 * sessions, providers, and extensions in another application.
 *
 * @example Compose a host
 * ```ts
 * import {
 *   createAgentCore,
 *   createCodingAgent,
 *   createProviderRegistry,
 *   jsonSessionRepository,
 * } from "@glrs-dev/glrs";
 *
 * const runtime = createAgentCore({
 *   session,
 *   runTurn,
 *   reloadExtensions,
 * });
 * const agent = createCodingAgent({
 *   runtime,
 *   sessionRepository: jsonSessionRepository,
 *   providers: createProviderRegistry(),
 * });
 * ```
 *
 * @module SDK
 * @group API
 */

import type { ProviderRegistry } from "../../glrs-providers/src";
import type { AgentCore, ModelProvider, SessionRepository } from "./index";
import type { Extension } from "./public-extension-api";

export type {
  ProviderAdapter,
  ProviderRegistry,
} from "../../glrs-providers/src";
export { createProviderRegistry } from "../../glrs-providers/src";
export type {
  AgentCore,
  ModelProvider,
  Session,
  SessionEvent,
  SessionRepository,
  Turn,
} from "./index";
export {
  createAgentCore,
  jsonSessionRepository,
} from "./index";
export type { Extension } from "./public-extension-api";

/** Services required to compose a coding-agent host. */
export type CodingAgentDependencies = {
  /** Turn and session runtime. */
  runtime: AgentCore;
  /** Durable session storage. */
  sessionRepository: SessionRepository;
  /** Model-provider lookup and registration. */
  providers: ProviderRegistry;
  /** Extensions initialized by the embedding host. */
  extensions?: readonly Extension[];
  /** Optional selected model provider. */
  model?: ModelProvider;
};

/** Composed product boundary. The TUI and CLI are adapters around this host. */
export type CodingAgent = AgentCore & {
  dependencies: CodingAgentDependencies;
};

/** Create a coding-agent host from explicit runtime dependencies. */
export const createCodingAgent = (dependencies: CodingAgentDependencies): CodingAgent => ({
  ...dependencies.runtime,
  dependencies,
});
