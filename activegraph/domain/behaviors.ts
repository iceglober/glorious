/**
 * Behaviors — the reactive units, as plain composable values.
 *
 * A behavior subscribes to event types (`on`) plus an optional `where`
 * predicate, and RETURNS mutations instead of performing them (`run(event,
 * ctx) => Mutation<S>[]`). `createKit(schema)` fixes the schema once so every
 * constructor infers only its own narrow parameters: `on: ["task.completed"]`
 * narrows the handler's `event.payload`, thanks to the `const K` parameter —
 * the same intra-object inference the repo's `defineTool` relies on.
 *
 * `kit.behavior` is the library's single controlled widening point: it
 * returns the K-typed definition as the erased `AnyBehavior<S>` used by the
 * registry. The cast is sound because `matchBehaviors` only ever dispatches
 * events whose type is in `on` — the erased `run` can only receive events the
 * typed `run` declared. No other module widens behavior types.
 *
 * `relationBehavior` is pure sugar (the Python `@relation_behavior`): it
 * desugars to a behavior that fires once per relation of the declared type
 * whose endpoints are referenced by the event's payload — "coordination logic
 * on the edge, not on either endpoint". `llmBehavior` wires prompt → LLM →
 * zod-parsed structured output → mutations; an unusable reply is re-asked
 * `retries` times with the complaint appended, and then throws, which the
 * runtime records as a `behavior.failed` event.
 *
 * Combinators (`when`, `whereObject`, `mapMutations`) are ordinary
 * `AnyBehavior<S> => AnyBehavior<S>` functions, composable with `pipe`.
 */
import type z from "zod";
import { err, ok, type Result } from "../lib/fp";
import type { LlmError, LlmRequest, LlmResponse, ToolError } from "./effects";
import type { AnyEvent, EventMap, EventName, EventUnion } from "./events";
import type { GraphRelation } from "./graph";
import { createMutations, type Mutation, type MutationBuilder } from "./mutations";
import type { ObjectData, ObjectTypeName, RelationTypeName, SchemaDef } from "./schema";
import type { GraphView } from "./view";

export interface BehaviorContext<S extends SchemaDef> {
  readonly view: GraphView<S>;
  readonly m: MutationBuilder<S>;
  /** Log-caching LLM capability; calls become llm.requested/responded events. */
  readonly llm: (request: LlmRequest) => Promise<Result<LlmResponse, LlmError>>;
  readonly tool: (name: string, input: unknown) => Promise<Result<unknown, ToolError>>;
}

export type BehaviorRun<S extends SchemaDef, K extends EventName<S>> = (
  event: EventUnion<S, K>,
  ctx: BehaviorContext<S>,
) => Promise<readonly Mutation<S>[]> | readonly Mutation<S>[];

export interface BehaviorDef<S extends SchemaDef, K extends EventName<S>> {
  readonly name: string;
  readonly on: readonly K[];
  readonly where?: (event: EventUnion<S, K>, view: GraphView<S>) => boolean;
  readonly run: BehaviorRun<S, K>;
}

/** Registry-side erased form: dispatch guarantees event.type ∈ on at runtime. */
export interface AnyBehavior<S extends SchemaDef> {
  readonly name: string;
  readonly on: readonly EventName<S>[];
  readonly where?: (event: AnyEvent<S>, view: GraphView<S>) => boolean;
  readonly run: (
    event: AnyEvent<S>,
    ctx: BehaviorContext<S>,
  ) => Promise<readonly Mutation<S>[]> | readonly Mutation<S>[];
}

/** Every string anywhere in a payload — how relation behaviors detect endpoint references. */
const parseLlmJson = (text: string): unknown => {
  let candidate = text.trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
    if (fenced !== undefined) candidate = fenced.trim();
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed !== "string") return parsed;
    candidate = parsed.trim();
  }
  return JSON.parse(candidate);
};

/** Parse and validate one reply, reporting why it could not be used. */
const readOutput = <Out extends z.ZodType>(
  output: Out,
  text: string,
): Result<z.infer<Out>, string> => {
  let json: unknown;
  try {
    json = parseLlmJson(text);
  } catch {
    return err(`llm output is not JSON: ${text.slice(0, 200)}`);
  }
  const parsed = output.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : err(
        `llm output failed schema: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      );
};

/** Re-ask by appending the complaint, so the retry is a distinct request. */
const retryPrompt = (request: LlmRequest, complaint: string): string =>
  `${request.prompt}\n\nYour previous reply could not be used: ${complaint}\nReply with JSON only, matching the requested shape exactly.`;

const referencedIds = (payload: unknown, into: Set<string> = new Set()): Set<string> => {
  if (typeof payload === "string") into.add(payload);
  else if (Array.isArray(payload)) for (const item of payload) referencedIds(item, into);
  else if (payload !== null && typeof payload === "object") {
    for (const value of Object.values(payload)) referencedIds(value, into);
  }
  return into;
};

/** Schema-bound toolkit: fixes S once so every constructor infers only K/T/R. */
export interface Kit<S extends SchemaDef> {
  readonly behavior: <const K extends EventName<S>>(def: BehaviorDef<S, K>) => AnyBehavior<S>;
  readonly relationBehavior: <RT extends RelationTypeName<S>, const K extends EventName<S>>(def: {
    readonly name: string;
    readonly relationType: RT;
    readonly on: readonly K[];
    readonly run: (options: {
      readonly event: EventUnion<S, K>;
      readonly relation: GraphRelation<S, RT>;
      readonly ctx: BehaviorContext<S>;
    }) => Promise<readonly Mutation<S>[]> | readonly Mutation<S>[];
  }) => AnyBehavior<S>;
  readonly llmBehavior: <const K extends EventName<S>, Out extends z.ZodType>(def: {
    readonly name: string;
    readonly on: readonly K[];
    readonly where?: (event: EventUnion<S, K>, view: GraphView<S>) => boolean;
    readonly prompt: (event: EventUnion<S, K>, view: GraphView<S>) => LlmRequest;
    readonly output: Out;
    /**
     * Extra attempts when the reply is not usable JSON for `output`. Each one
     * re-asks with the complaint appended, so it is an ordinary logged call
     * with its own hash — a replay serves it from the recording like any other.
     */
    readonly retries?: number;
    readonly andThen: (
      output: z.infer<Out>,
      event: EventUnion<S, K>,
      ctx: BehaviorContext<S>,
    ) => Promise<readonly Mutation<S>[]> | readonly Mutation<S>[];
  }) => AnyBehavior<S>;
  readonly m: MutationBuilder<S>;
}

export const createKit = <S extends SchemaDef>(schema: S): Kit<S> => {
  const m = createMutations(schema);
  // The single controlled widening point; sound because matchBehaviors only
  // dispatches events whose type is in `on`.
  const widen = <K extends EventName<S>>(def: BehaviorDef<S, K>): AnyBehavior<S> =>
    def as unknown as AnyBehavior<S>;

  return {
    m,
    behavior: (def) => widen(def),
    relationBehavior: (def) =>
      widen({
        name: def.name,
        on: def.on,
        where: (event, view) => {
          const ids = referencedIds(event.payload);
          return view
            .relations(def.relationType)
            .some((relation) => ids.has(relation.source) || ids.has(relation.target));
        },
        run: async (event, ctx) => {
          const ids = referencedIds(event.payload);
          const touched = ctx.view
            .relations(def.relationType)
            .filter((relation) => ids.has(relation.source) || ids.has(relation.target));
          const mutations: Mutation<S>[] = [];
          for (const relation of touched) {
            mutations.push(...(await def.run({ event, relation, ctx })));
          }
          return mutations;
        },
      }),
    llmBehavior: (def) =>
      widen({
        name: def.name,
        on: def.on,
        where: def.where,
        run: async (event, ctx) => {
          const request = def.prompt(event, ctx.view);
          let complaint: string | undefined;
          for (let attempt = 0; ; attempt += 1) {
            const asked =
              complaint === undefined
                ? request
                : { ...request, prompt: retryPrompt(request, complaint) };
            const response = await ctx.llm(asked);
            if (!response.ok) {
              throw new Error(`llm ${response.error.reason}: ${JSON.stringify(response.error)}`);
            }
            const usable = readOutput(def.output, response.value.text);
            if (usable.ok) return def.andThen(usable.value, event, ctx);
            // A provider error is the world failing; unusable output is the
            // model failing, and telling it so is often enough.
            if (attempt >= (def.retries ?? 0)) throw new Error(usable.error);
            complaint = usable.error;
          }
        },
      }),
  };
};

// Combinators — functional composition over behaviors.

/** Conjoin an extra predicate with the behavior's existing `where`. */
export const when =
  <S extends SchemaDef>(pred: (event: AnyEvent<S>, view: GraphView<S>) => boolean) =>
  (b: AnyBehavior<S>): AnyBehavior<S> => ({
    ...b,
    where: (event, view) => pred(event, view) && (b.where?.(event, view) ?? true),
  });

/**
 * Declarative port of the Python `where={"object.type": ..., "object.data...": ...}`:
 * true when the event references an object of `type` whose data matches every
 * given key. Usable directly as a `where` or lifted with `when`.
 */
export const whereObject =
  <S extends SchemaDef, T extends ObjectTypeName<S>>(type: T, match: Partial<ObjectData<S, T>>) =>
  (event: AnyEvent<S>, view: GraphView<S>): boolean => {
    const ids = referencedIds(event.payload);
    return view
      .objects(type)
      .some(
        (object) =>
          ids.has(object.id) &&
          Object.entries(match as Record<string, unknown>).every(
            (entry) => (object.data as Record<string, unknown>)[entry[0]] === entry[1],
          ),
      );
  };

/** Post-process the mutations a behavior returns. */
export const mapMutations =
  <S extends SchemaDef>(f: (mutations: readonly Mutation<S>[]) => readonly Mutation<S>[]) =>
  (b: AnyBehavior<S>): AnyBehavior<S> => ({
    ...b,
    run: async (event, ctx) => f(await b.run(event, ctx)),
  });

/** Pure matching: type ∈ on, then where; registry order preserved (determinism). */
export const matchBehaviors = <S extends SchemaDef>(options: {
  readonly event: AnyEvent<S>;
  readonly behaviors: readonly AnyBehavior<S>[];
  readonly view: GraphView<S>;
}): readonly AnyBehavior<S>[] =>
  options.behaviors.filter(
    (b) =>
      (b.on as readonly string[]).includes(options.event.type) &&
      (b.where?.(options.event, options.view) ?? true),
  );

/** Custom-event helper mirroring EventMap for external emitters. */
export type CustomPayload<S extends SchemaDef, K extends EventName<S>> = EventMap<S>[K];
