/**
 * The canonical example — a TypeScript port of the Python README's
 * task-pipeline scenario (planner → researcher → relation-behavior unblock).
 * Doubles as the shared fixture for the shell test suite and the README
 * quickstart, so the documented example is executable and executed.
 */
import { z } from "zod";
import { type AnyBehavior, createKit } from "./domain/behaviors";
import { defineSchema } from "./domain/schema";

export const exampleSchema = defineSchema({
  objects: {
    task: z.object({
      title: z.string(),
      status: z.enum(["open", "blocked", "done"]),
    }),
    claim: z.object({
      text: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  },
  relations: {
    depends_on: { source: "task", target: "task" },
  },
  events: {
    "task.completed": z.object({ taskId: z.string() }),
  },
});
export type ExampleSchema = typeof exampleSchema;

export const exampleKit = createKit(exampleSchema);

/**
 * planner: reacts to the goal by laying out the plan — an open research task,
 * a blocked memo task, and the dependency edge between them.
 */
export const planner = exampleKit.behavior({
  name: "planner",
  on: ["goal.created"],
  run: (_event, ctx) => {
    const research = ctx.m.addObject("task", { title: "Research", status: "open" });
    const memo = ctx.m.addObject("task", { title: "Draft memo", status: "blocked" });
    return [research, memo];
  },
});

/**
 * wirer: once both tasks exist, connect them. Split from planner because
 * derived object ids are assigned at apply time — a second behavior reads
 * them from the graph, which also demonstrates reading typed views.
 */
export const wirer = exampleKit.behavior({
  name: "wirer",
  on: ["object.created"],
  where: (event, view) =>
    event.payload.objectType === "task" &&
    view.objects("task").length === 2 &&
    view.relations("depends_on").length === 0,
  run: (_event, ctx) => {
    // "Draft memo" sorts before "Research".
    const [memo, research] = [...ctx.view.objects("task")].sort((a, b) =>
      a.data.title.localeCompare(b.data.title),
    );
    if (research === undefined || memo === undefined) return [];
    return [ctx.m.addRelation("depends_on", memo.id, research.id)];
  },
});

/**
 * researcher: picks up the open research task, records a claim, and reports
 * completion as a custom event.
 */
export const researcher = exampleKit.behavior({
  name: "researcher",
  on: ["object.created"],
  where: (event) =>
    event.payload.objectType === "task" &&
    event.payload.data.status === "open" &&
    event.payload.data.title.includes("Research"),
  run: (event, ctx) => {
    if (event.type !== "object.created" || event.payload.objectType !== "task") return [];
    return [
      ctx.m.addObject("claim", { text: "Market early but growing.", confidence: 0.7 }),
      ctx.m.emit("task.completed", { taskId: event.payload.objectId }),
    ];
  },
});

/**
 * unblock: coordination logic on the edge — when a task completes, any task
 * depending on it opens up. Fires only for depends_on relations whose
 * endpoints the event references.
 */
export const unblock = exampleKit.relationBehavior({
  name: "unblock",
  relationType: "depends_on",
  on: ["task.completed"],
  run: ({ event, relation, ctx }) => {
    if (event.type === "task.completed" && event.payload.taskId === relation.target) {
      return [ctx.m.patchObject("task", relation.source, { status: "open" })];
    }
    return [];
  },
});

export const exampleBehaviors: readonly AnyBehavior<ExampleSchema>[] = [
  planner,
  wirer,
  researcher,
  unblock,
];
