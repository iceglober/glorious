import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { err, ok, pipe } from "../lib/fp";
import {
  type BehaviorContext,
  createKit,
  mapMutations,
  matchBehaviors,
  when,
  whereObject,
} from "./behaviors";
import type { AnyEvent } from "./events";
import { project } from "./graph";
import { defineSchema } from "./schema";
import { createGraphView } from "./view";

const schema = defineSchema({
  objects: {
    task: z.object({ title: z.string(), status: z.enum(["open", "blocked", "done"]) }),
    note: z.object({ text: z.string() }),
  },
  relations: {
    depends_on: { source: "task", target: "task" },
  },
  events: { "task.completed": z.object({ taskId: z.string() }) },
});
type S1 = typeof schema;
const kit = createKit(schema);

const ev = (id: number, type: string, payload: unknown) =>
  ({
    id,
    branch: "main",
    type,
    payload,
    causedBy: null,
    at: "2026-01-01T00:00:00.000Z",
  }) as AnyEvent<S1>;

const log: AnyEvent<S1>[] = [
  ev(1, "object.created", {
    objectId: "t1",
    objectType: "task",
    data: { title: "Research", status: "open" },
  }),
  ev(2, "object.created", {
    objectId: "t2",
    objectType: "task",
    data: { title: "Memo", status: "blocked" },
  }),
  ev(3, "relation.created", {
    relationId: "r1",
    relationType: "depends_on",
    source: "t1",
    target: "t2",
  }),
];
const state = () => project<S1>(log);
const view = () => createGraphView({ state: state(), log });

const ctx = (): BehaviorContext<S1> => ({
  view: view(),
  m: kit.m,
  llm: async () => err({ reason: "no_llm_port" as const }),
  tool: async () => ok("unused"),
});

describe("matchBehaviors", () => {
  test("matches on event type, honors where, and preserves registry order", () => {
    const a = kit.behavior({ name: "a", on: ["task.completed"], run: () => [] });
    const b = kit.behavior({
      name: "b",
      on: ["task.completed"],
      where: (event) => event.payload.taskId === "never",
      run: () => [],
    });
    const c = kit.behavior({ name: "c", on: ["task.completed", "goal.created"], run: () => [] });
    const d = kit.behavior({ name: "d", on: ["goal.created"], run: () => [] });

    const matched = matchBehaviors({
      event: ev(4, "task.completed", { taskId: "t1" }),
      behaviors: [c, a, b, d],
      view: view(),
    });
    expect(matched.map((x) => x.name)).toEqual(["c", "a"]);
  });
});

describe("relationBehavior", () => {
  test("fires once per relation of its type whose endpoint the event references", async () => {
    const seen: string[] = [];
    const unblock = kit.relationBehavior({
      name: "unblock",
      relationType: "depends_on",
      on: ["task.completed"],
      run: ({ event, relation, ctx }) => {
        seen.push(relation.id);
        if (event.type === "task.completed" && event.payload.taskId === relation.source) {
          return [ctx.m.patchObject("task", relation.target, { status: "open" })];
        }
        return [];
      },
    });

    const touching = ev(4, "task.completed", { taskId: "t1" });
    expect(unblock.where?.(touching, view())).toBe(true);
    const mutations = await unblock.run(touching, ctx());
    expect(seen).toEqual(["r1"]);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      kind: "patchObject",
      objectId: "t2",
      patch: { status: "open" },
    });
  });

  test("does not fire for events that reference no endpoint of its relation type", () => {
    const unblock = kit.relationBehavior({
      name: "unblock",
      relationType: "depends_on",
      on: ["task.completed"],
      run: () => [],
    });
    const unrelated = ev(4, "task.completed", { taskId: "someone-else" });
    expect(unblock.where?.(unrelated, view())).toBe(false);
    expect(matchBehaviors({ event: unrelated, behaviors: [unblock], view: view() })).toHaveLength(
      0,
    );
  });
});

describe("llmBehavior", () => {
  const claimBehavior = () =>
    kit.llmBehavior({
      name: "claimer",
      on: ["task.completed"],
      prompt: (event) => ({
        prompt: `summarize ${event.type === "task.completed" ? event.payload.taskId : ""}`,
      }),
      output: z.object({ text: z.string(), confidence: z.number() }),
      andThen: (output, _event, ctx) => [ctx.m.addObject("note", { text: output.text })],
    });

  test("parses structured output through zod and maps it to mutations", async () => {
    const withLlm: BehaviorContext<S1> = {
      ...ctx(),
      llm: async () => ok({ text: JSON.stringify({ text: "market is growing", confidence: 0.7 }) }),
    };
    const mutations = await claimBehavior().run(ev(4, "task.completed", { taskId: "t1" }), withLlm);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ kind: "addObject", objectType: "note" });
  });

  test("unwraps JSON encoded as a JSON string", async () => {
    const withLlm: BehaviorContext<S1> = {
      ...ctx(),
      llm: async () =>
        ok({
          text: JSON.stringify(JSON.stringify({ text: "market is growing", confidence: 0.7 })),
        }),
    };
    const mutations = await claimBehavior().run(ev(4, "task.completed", { taskId: "t1" }), withLlm);
    expect(mutations).toHaveLength(1);
  });

  test("unwraps JSON strings containing a fenced JSON response", async () => {
    const withLlm: BehaviorContext<S1> = {
      ...ctx(),
      llm: async () =>
        ok({
          text: JSON.stringify(
            `\`\`\`json\n${JSON.stringify({ text: "market is growing", confidence: 0.7 })}\n\`\`\``,
          ),
        }),
    };
    const mutations = await claimBehavior().run(ev(4, "task.completed", { taskId: "t1" }), withLlm);
    expect(mutations).toHaveLength(1);
  });

  test("throws (→ behavior.failed) on malformed or schema-failing output", async () => {
    const notJson: BehaviorContext<S1> = { ...ctx(), llm: async () => ok({ text: "not json" }) };
    expect(claimBehavior().run(ev(4, "task.completed", { taskId: "t1" }), notJson)).rejects.toThrow(
      /not JSON/,
    );
    const wrongShape: BehaviorContext<S1> = {
      ...ctx(),
      llm: async () => ok({ text: JSON.stringify({ nope: true }) }),
    };
    expect(
      claimBehavior().run(ev(4, "task.completed", { taskId: "t1" }), wrongShape),
    ).rejects.toThrow(/failed schema/);
    const portless: BehaviorContext<S1> = ctx();
    expect(
      claimBehavior().run(ev(4, "task.completed", { taskId: "t1" }), portless),
    ).rejects.toThrow(/no_llm_port/);
  });
});

describe("combinators compose with pipe", () => {
  test("when conjoins predicates; mapMutations post-processes results", async () => {
    const base = kit.behavior({
      name: "researcher",
      on: ["task.completed"],
      run: (_event, ctx) => [ctx.m.addObject("note", { text: "finding" })],
    });

    const composed = pipe(
      base,
      when<S1>((event) => event.type === "task.completed" && event.payload.taskId === "t1"),
      mapMutations<S1>((mutations) => [...mutations, ...mutations]),
    );

    expect(composed.where?.(ev(4, "task.completed", { taskId: "t2" }), view())).toBe(false);
    expect(composed.where?.(ev(4, "task.completed", { taskId: "t1" }), view())).toBe(true);
    const doubled = await composed.run(ev(4, "task.completed", { taskId: "t1" }), ctx());
    expect(doubled).toHaveLength(2);
  });

  test("whereObject matches referenced objects by type and data", () => {
    const openTask = whereObject<S1, "task">("task", { status: "open" });
    expect(openTask(ev(4, "task.completed", { taskId: "t1" }), view())).toBe(true);
    // t2 is blocked, so a t2-referencing event fails the { status: "open" } match.
    expect(openTask(ev(4, "task.completed", { taskId: "t2" }), view())).toBe(false);
  });
});
