import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../adapters/clocks";
import { createFakeLlm } from "../adapters/fake-llm";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import type { LlmRequest } from "../domain/effects";
import { hashRequest } from "../domain/events";
import { objectId } from "../index";
import { unwrap } from "../lib/fp";
import type { LlmPort } from "../ports/llm";
import type { ToolExecutor } from "../ports/tools";
import { replayStrict } from "../shell/replay";
import { createRuntime } from "../shell/runtime";
import {
  type AgentSettings,
  type CodingAgentSchema,
  codingAgentKit,
  codingAgentSchema,
  createCodingAgentBehaviors,
  DEFAULT_LIMITS,
  unfinishedTasks,
  type Workspace,
} from "./coding-agent";

const workspace: Workspace = { cwd: "/repo", gitRoot: "/repo", entries: ["README.md", "src/"] };
const elsewhere: Workspace = { cwd: "/elsewhere", entries: ["Cargo.toml"] };
const config: AgentSettings = { model: "planner-model" };

const planJson = JSON.stringify({
  summary: "Add a greeting",
  commands: [
    { description: "inspect the project", command: "ls" },
    { description: "write the greeting", command: "printf hello" },
  ],
});
const doneJson = JSON.stringify({ done: true, report: "the commands did what was asked" });

const isReview = (request: LlmRequest): boolean =>
  request.system?.startsWith("You are") === true ? request.system.includes("reviewing") : false;

/** Plan on the planner's request, and report done on the reviewer's. */
const planThenDone = () => createFakeLlm((request) => (isReview(request) ? doneJson : planJson));

const runAgent = async (options: {
  readonly llm: LlmPort;
  readonly tools: ToolExecutor;
  readonly config?: AgentSettings;
  readonly goal?: string;
  /** Omit to run without ever sampling a workspace. */
  readonly workspace?: Workspace | null;
}) => {
  const runtime = unwrap(
    await createRuntime<CodingAgentSchema>({
      schema: codingAgentSchema,
      behaviors: createCodingAgentBehaviors(),
      eventStore: createMemoryEventStore<CodingAgentSchema>(),
      graphStore: createMemoryGraphStore<CodingAgentSchema>(),
      clock: createFixedClock(),
      llm: options.llm,
      tools: options.tools,
    }),
  );
  unwrap(await runtime.emit("settings.configured", options.config ?? config));
  const sampled = options.workspace === undefined ? workspace : options.workspace;
  if (sampled !== null) unwrap(await runtime.emit("workspace.sampled", sampled));
  const status = unwrap(await runtime.runGoal(options.goal ?? "Add a greeting to the project"));
  return { runtime, status };
};

const recordingTools = () => {
  const calls: unknown[] = [];
  const tools: ToolExecutor = {
    execute: async (name, input) => {
      calls.push({ name, input });
      return { ok: true, value: `ran ${(input as { command: string }).command}` };
    },
  };
  return { calls, tools };
};

const failures = (runtime: { log: () => readonly { type: unknown; payload: unknown }[] }) =>
  runtime.log().filter((event) => (event.type as string) === "behavior.failed");

/** Successive goals against one log, the way repeated runs in a directory go. */
const sharedLogRunner = (requests: LlmRequest[]) => {
  const store = createMemoryEventStore<CodingAgentSchema>();
  const graphStore = createMemoryGraphStore<CodingAgentSchema>();
  const llm = createFakeLlm((request) => {
    requests.push(request);
    return isReview(request) ? doneJson : planJson;
  });
  const run = async (next: AgentSettings, goal: string, where: Workspace = workspace) => {
    const runtime = unwrap(
      await createRuntime<CodingAgentSchema>({
        schema: codingAgentSchema,
        behaviors: createCodingAgentBehaviors(),
        eventStore: store,
        graphStore,
        clock: createFixedClock(),
        llm,
        tools: { execute: async () => ({ ok: true, value: "" }) },
      }),
    );
    unwrap(await runtime.emit("settings.configured", next));
    unwrap(await runtime.emit("workspace.sampled", where));
    unwrap(await runtime.runGoal(goal));
  };
  return { store, run };
};

describe("coding agent", () => {
  test("plans, executes, and records a coding task", async () => {
    const { calls, tools } = recordingTools();
    const { runtime, status } = await runAgent({ llm: planThenDone(), tools });

    expect(calls).toHaveLength(2);
    expect(runtime.view().objects("task")[0]?.data).toMatchObject({
      request: "Add a greeting to the project",
      summary: "Add a greeting",
      status: "completed",
    });
    expect(
      runtime
        .view()
        .objects("command")
        .every((command) => command.data.status === "completed"),
    ).toBe(true);
    expect(runtime.log().some((event) => (event.type as string) === "tool.responded")).toBe(true);
    expect(failures(runtime)).toEqual([]);
    expect(status.status).toBe("idle");
  });

  test("tool failures complete the graph with a failed task", async () => {
    const { runtime } = await runAgent({
      llm: planThenDone(),
      tools: {
        execute: async () => ({
          ok: false,
          error: { reason: "tool_error", message: "permission denied" },
        }),
      },
    });
    expect(runtime.view().objects("task")[0]?.data.status).toBe("failed");
    // What the reviewer reads and the operator sees: the sentence, not the
    // envelope it arrived in.
    expect(runtime.view().objects("command")[0]?.data.output).toBe("permission denied");
  });

  test("work a killed run left behind is findable, and scoped to this directory", async () => {
    // Exactly the shape a process killed mid-command leaves: the task and the
    // command exist, and the patch that would have recorded the result never
    // arrived.
    const runtime = unwrap(
      await createRuntime<CodingAgentSchema>({
        schema: codingAgentSchema,
        behaviors: [],
        eventStore: createMemoryEventStore<CodingAgentSchema>(),
        graphStore: createMemoryGraphStore<CodingAgentSchema>(),
        clock: createFixedClock(),
      }),
    );
    const m = codingAgentKit.m;
    const taskId = objectId<"task">("task_goal_1");
    const commandId = objectId<"command">("command_task_goal_1_r0_0");
    unwrap(
      await runtime.propose([
        m.addObject(
          "task",
          { request: "Rebuild the index", summary: "…", status: "planned", cwd: "/repo", round: 0 },
          { id: taskId },
        ),
        m.addObject(
          "command",
          { description: "rebuild", command: "make index", status: "pending", round: 0 },
          { id: commandId },
        ),
        m.addRelation("has_command", taskId, commandId),
      ]),
    );

    expect(unfinishedTasks(runtime.view(), "/repo")).toEqual([
      { request: "Rebuild the index", status: "planned", outstanding: 1 },
    ]);
    // Another directory's abandoned work is not this directory's problem.
    expect(unfinishedTasks(runtime.view(), "/elsewhere")).toEqual([]);
  });

  test("a finished run leaves nothing unfinished", async () => {
    const { tools } = recordingTools();
    const { runtime } = await runAgent({ llm: planThenDone(), tools });

    expect(unfinishedTasks(runtime.view(), "/repo")).toEqual([]);
  });

  test("a tool that throws still leaves a settled task, not a stranded one", async () => {
    const { runtime } = await runAgent({
      llm: planThenDone(),
      tools: {
        execute: async () => {
          throw new Error("posix_spawn failed");
        },
      },
    });

    // Without the guard this is a failed behavior and a command stuck at
    // pending, so the task never settles and no report is ever written.
    expect(runtime.view().objects("command")[0]?.data.status).toBe("failed");
    expect(runtime.view().objects("command")[0]?.data.output).toContain("posix_spawn failed");
    expect(runtime.view().objects("task")[0]?.data.status).toBe("failed");
    expect(failures(runtime)).toEqual([]);
  });

  test("every command carries the workspace directory and its limits", async () => {
    const { calls, tools } = recordingTools();
    await runAgent({
      tools,
      llm: planThenDone(),
      config: { ...config, timeoutMs: 1_234, maxOutputBytes: 5_678 },
    });

    expect(calls[0]).toEqual({
      name: "bash",
      input: {
        command: "ls",
        // The planner's label travels with the command, so the layer that
        // shows it to a person has something readable to show.
        description: "inspect the project",
        cwd: "/repo",
        timeoutMs: 1_234,
        maxOutputBytes: 5_678,
      },
    });
  });

  test("commands fall back to the default limits", async () => {
    const { calls, tools } = recordingTools();
    await runAgent({ tools, llm: planThenDone() });

    expect(calls[0]).toMatchObject({ input: DEFAULT_LIMITS });
  });

  test("the planner prompt carries the workspace", async () => {
    const requests: LlmRequest[] = [];
    const { tools } = recordingTools();
    await runAgent({
      tools,
      goal: "Summarize this project",
      llm: createFakeLlm((request) => {
        requests.push(request);
        return isReview(request) ? doneJson : planJson;
      }),
    });

    expect(requests[0]?.prompt).toContain("/repo");
    expect(requests[0]?.prompt).toContain("README.md");
    expect(requests[0]?.prompt).toContain("Summarize this project");
  });

  test("the planner is told the branch and what is uncommitted", async () => {
    const requests: LlmRequest[] = [];
    const { tools } = recordingTools();
    const capture = createFakeLlm((request) => {
      requests.push(request);
      return isReview(request) ? doneJson : planJson;
    });

    await runAgent({
      tools,
      llm: capture,
      workspace: { ...workspace, branch: "main", dirty: [" M README.md", "?? notes.txt"] },
    });
    expect(requests[0]?.prompt).toContain("(branch main)");
    expect(requests[0]?.prompt).toContain("Uncommitted changes:");
    expect(requests[0]?.prompt).toContain("M README.md");

    requests.length = 0;
    await runAgent({ tools, llm: capture, workspace: { ...workspace, branch: "main", dirty: [] } });
    expect(requests[0]?.prompt).toContain("Uncommitted changes: none");

    // Outside a repository there is no branch and nothing to protect.
    requests.length = 0;
    await runAgent({ tools, llm: capture, workspace: elsewhere });
    expect(requests[0]?.prompt).toContain("Git: not a repository");
    expect(requests[0]?.prompt).not.toContain("Uncommitted changes");
  });

  test("the reviewer reads the command output and records a report", async () => {
    const requests: LlmRequest[] = [];
    const { tools } = recordingTools();
    const { runtime } = await runAgent({
      tools,
      llm: createFakeLlm((request) => {
        requests.push(request);
        return isReview(request) ? doneJson : planJson;
      }),
    });

    const reviewRequest = requests.find(isReview);
    expect(reviewRequest?.prompt).toContain("ran printf hello");
    expect(reviewRequest?.prompt).toContain("Rounds used: 0 of 2");
    expect(runtime.view().objects("task")[0]?.data.report).toBe("the commands did what was asked");
  });

  test("one failed command ends the round; the rest are skipped, not run", async () => {
    const ran: string[] = [];
    const { runtime } = await runAgent({
      llm: createFakeLlm((request) =>
        isReview(request)
          ? doneJson
          : JSON.stringify({
              summary: "Three steps",
              commands: [
                { description: "works", command: "first" },
                { description: "breaks", command: "second" },
                { description: "never happens", command: "third" },
              ],
            }),
      ),
      tools: {
        execute: async (_name, input) => {
          const command = (input as { command: string }).command;
          ran.push(command);
          return command === "second"
            ? { ok: false, error: { reason: "tool_error", message: "boom" } }
            : { ok: true, value: "out" };
        },
      },
    });

    // The third command never reached a shell.
    expect(ran).toEqual(["first", "second"]);
    expect(
      runtime
        .view()
        .objects("command")
        .map((command) => command.data.status),
    ).toEqual(["completed", "failed", "skipped"]);
    expect(runtime.view().objects("command")[2]?.data.output).toContain("Skipped");
    // A skipped command is terminal, so the task still settles — as failed.
    expect(runtime.view().objects("task")[0]?.data.status).toBe("failed");
  });

  test("a follow-up round can bring a failed task back to completed", async () => {
    let reviews = 0;
    const llm = createFakeLlm((request) => {
      if (!isReview(request)) {
        return JSON.stringify({
          summary: "Try the thing",
          commands: [{ description: "the broken step", command: "bad" }],
        });
      }
      reviews += 1;
      return reviews === 1
        ? JSON.stringify({
            done: false,
            report: "the first command failed; retrying",
            commands: [{ description: "the fix", command: "good" }],
          })
        : JSON.stringify({ done: true, report: "the retry worked" });
    });
    const { runtime } = await runAgent({
      llm,
      tools: {
        execute: async (_name, input) =>
          (input as { command: string }).command === "bad"
            ? { ok: false, error: { reason: "tool_error", message: "boom" } }
            : { ok: true, value: "fixed" },
      },
    });

    const task = runtime.view().objects("task")[0];
    // Round 0 failed and stays in the graph; the task follows the newest round.
    expect(runtime.view().objects("command")).toHaveLength(2);
    expect(runtime.view().objects("command")[0]?.data.status).toBe("failed");
    expect(task?.data).toMatchObject({ status: "completed", round: 1, report: "the retry worked" });
    expect(reviews).toBe(2);
    expect(failures(runtime)).toEqual([]);
  });

  test("a later round is not re-sent the earlier round's output", async () => {
    const prompts: string[] = [];
    let reviews = 0;
    await runAgent({
      tools: {
        execute: async () => ({ ok: true, value: "OUTPUT-THAT-SHOULD-NOT-REPEAT" }),
      },
      llm: createFakeLlm((request) => {
        if (!isReview(request)) {
          return JSON.stringify({
            summary: "First",
            commands: [{ description: "round zero", command: "first-command" }],
          });
        }
        prompts.push(request.prompt);
        reviews += 1;
        return reviews === 1
          ? JSON.stringify({
              done: false,
              report: "more to do",
              commands: [{ description: "round one", command: "second-command" }],
            })
          : doneJson;
      }),
    });

    expect(reviews).toBe(2);
    // Round 0's output is in the first review and spent by the second.
    expect(prompts[0]).toContain("OUTPUT-THAT-SHOULD-NOT-REPEAT");
    expect(prompts[1]?.match(/OUTPUT-THAT-SHOULD-NOT-REPEAT/g) ?? []).toHaveLength(1);
    // What it did keeps its one line, so the reviewer still knows it happened.
    expect(prompts[1]).toContain("Earlier rounds, already reviewed:");
    expect(prompts[1]).toContain("[round 0, completed] first-command");
    expect(prompts[1]).toContain("second-command");
  });

  test("the reviewer is told when a round failed exactly as the last one did", async () => {
    const prompts: string[] = [];
    let reviews = 0;
    await runAgent({
      config: { ...config, maxRounds: 3 },
      // The same error every time: an edit that claims success but changes
      // nothing, which is what a guarded in-place edit does on a retry.
      tools: {
        execute: async (_name, input) =>
          (input as { command: string }).command === "run-the-tests"
            ? { ok: false, error: { reason: "tool_error", message: "describe is not defined" } }
            : { ok: true, value: "edited" },
      },
      llm: createFakeLlm((request) => {
        if (!isReview(request)) {
          return JSON.stringify({
            summary: "Add it",
            commands: [
              { description: "edit", command: "edit-the-file" },
              { description: "test", command: "run-the-tests" },
            ],
          });
        }
        prompts.push(request.prompt);
        reviews += 1;
        return reviews > 2
          ? doneJson
          : JSON.stringify({
              done: false,
              report: "fixing the import",
              commands: [
                { description: "edit again", command: "edit-the-file" },
                { description: "test", command: "run-the-tests" },
              ],
            });
      }),
    });

    // Round 0 has nothing to compare against; round 1 repeats round 0 exactly.
    expect(prompts[0]).not.toContain("failed exactly as");
    expect(prompts[1]).toContain("round 1 failed exactly as round 0 did");
    expect(prompts[2]).toContain("round 2 failed exactly as round 1 did");
  });

  test("a different failure is not reported as a repeat", async () => {
    const prompts: string[] = [];
    let attempts = 0;
    let reviews = 0;
    await runAgent({
      config: { ...config, maxRounds: 2 },
      tools: {
        execute: async (_name, input) => {
          if ((input as { command: string }).command !== "run-the-tests") {
            return { ok: true, value: "edited" };
          }
          attempts += 1;
          return {
            ok: false,
            error: { reason: "tool_error", message: `failure number ${attempts}` },
          };
        },
      },
      llm: createFakeLlm((request) => {
        if (!isReview(request)) {
          return JSON.stringify({
            summary: "Add it",
            commands: [{ description: "test", command: "run-the-tests" }],
          });
        }
        prompts.push(request.prompt);
        reviews += 1;
        return reviews > 1
          ? doneJson
          : JSON.stringify({
              done: false,
              report: "trying something else",
              commands: [{ description: "test", command: "run-the-tests" }],
            });
      }),
    });

    // Progress, of a sort: the error changed, so nothing is flagged.
    expect(prompts[1]).not.toContain("failed exactly as");
  });

  test("review rounds stop at maxRounds", async () => {
    let reviews = 0;
    const llm = createFakeLlm((request) => {
      if (!isReview(request)) {
        return JSON.stringify({
          summary: "Keep going",
          commands: [{ description: "step", command: "step" }],
        });
      }
      reviews += 1;
      return JSON.stringify({
        done: false,
        report: "still more to do",
        commands: [{ description: "another step", command: "step" }],
      });
    });
    const { calls, tools } = recordingTools();
    const { runtime } = await runAgent({
      llm,
      tools,
      config: { ...config, maxRounds: 1 },
    });

    // One planned round plus one review round, then it stops asking.
    expect(calls).toHaveLength(2);
    expect(reviews).toBe(2);
    expect(runtime.view().objects("task")[0]?.data.round).toBe(1);
    expect(runtime.view().objects("task")[0]?.data.report).toContain("Stopped after 1 round(s)");
    expect(failures(runtime)).toEqual([]);
  });

  test("a second goal is planned with the first one's outcome in the prompt", async () => {
    const requests: LlmRequest[] = [];
    const { store, run } = sharedLogRunner(requests);

    await run(config, "Set the project up");
    await run(config, "Now add a test");

    const plans = requests.filter((request) => !isReview(request));
    expect(plans).toHaveLength(2);
    expect(plans[0]?.prompt).not.toContain("Earlier goals");
    expect(plans[1]?.prompt).toContain("Earlier goals in this workspace");
    expect(plans[1]?.prompt).toContain("[completed] Set the project up");
    expect(plans[1]?.prompt).toContain("the commands did what was asked");

    // Two sessions over one log — what successive runs against the SQLite
    // store are — and the whole branch still re-derives byte for byte.
    expect(
      await replayStrict({
        schema: codingAgentSchema,
        behaviors: createCodingAgentBehaviors(),
        store,
        branch: "main",
      }),
    ).toEqual({ ok: true, value: undefined });
  });

  test("history is scoped to the directory and bounded by historyLimit", async () => {
    const requests: LlmRequest[] = [];
    const { run } = sharedLogRunner(requests);

    await run(config, "First here");
    await run(config, "Only over there", elsewhere);
    await run(config, "Second here");
    await run({ ...config, historyLimit: 0 }, "Third here");

    const plans = requests.filter((request) => !isReview(request));
    expect(plans[2]?.prompt).toContain("[completed] First here");
    // Another directory's work is not this directory's history.
    expect(plans[2]?.prompt).not.toContain("Only over there");
    expect(plans[3]?.prompt).not.toContain("Earlier goals");
  });

  test("the request hash discriminates on workspace and model", async () => {
    // Fresh logs, so history is constant and the only variables are the ones
    // under test. Equal hashes are exactly what the completion cache serves.
    const planFor = async (next: AgentSettings, where: Workspace): Promise<LlmRequest> => {
      const requests: LlmRequest[] = [];
      await runAgent({
        goal: "Summarize this project",
        tools: { execute: async () => ({ ok: true, value: "" }) },
        config: next,
        workspace: where,
        llm: createFakeLlm((request) => {
          requests.push(request);
          return isReview(request) ? doneJson : planJson;
        }),
      });
      const plan = requests.find((request) => !isReview(request));
      if (plan === undefined) throw new Error("the planner was never asked");
      return plan;
    };

    const base = await planFor(config, workspace);
    const again = await planFor(config, workspace);
    const otherDirectory = await planFor(config, elsewhere);
    const otherModel = await planFor({ ...config, model: "another-model" }, workspace);

    expect(hashRequest(again)).toBe(hashRequest(base));
    expect(hashRequest(otherDirectory)).not.toBe(hashRequest(base));
    // Same prompt bytes, different deployment: still a different key.
    expect(otherModel.prompt).toEqual(base.prompt);
    expect(hashRequest(otherModel)).not.toBe(hashRequest(base));
  });

  test("a branch replays without being told which directory it ran in", async () => {
    // The workspace arrived as an event, so it is in the log. Replaying needs
    // only the operator's knobs — nothing reconstructed from the filesystem.
    const requests: LlmRequest[] = [];
    const { store, run } = sharedLogRunner(requests);
    await run(config, "Set the project up");
    await run(config, "Now move the project", elsewhere);

    expect(
      await replayStrict({
        schema: codingAgentSchema,
        behaviors: createCodingAgentBehaviors(),
        store,
        branch: "main",
      }),
    ).toEqual({ ok: true, value: undefined });
  });

  test("a malformed reply costs a re-ask, not the run", async () => {
    let planCalls = 0;
    const { calls, tools } = recordingTools();
    const { runtime } = await runAgent({
      tools,
      llm: createFakeLlm((request) => {
        if (isReview(request)) return doneJson;
        planCalls += 1;
        // What a real model does now and then: prose instead of the object.
        return planCalls === 1 ? "Sure! Here is the plan you asked for." : planJson;
      }),
    });

    expect(planCalls).toBe(2);
    expect(calls).toHaveLength(2);
    expect(runtime.view().objects("task")[0]?.data.status).toBe("completed");
    expect(failures(runtime)).toEqual([]);
  });

  test("a risky-looking command parks even with the gate off", async () => {
    const { calls, tools } = recordingTools();
    const { runtime, status } = await runAgent({
      tools,
      llm: createFakeLlm((request) =>
        isReview(request)
          ? doneJson
          : JSON.stringify({
              summary: "Tidy up",
              commands: [
                { description: "harmless", command: "ls" },
                { description: "destructive", command: "rm -rf build" },
              ],
            }),
      ),
    });

    // The safe one ran without ceremony; the other is waiting on a person.
    expect(calls).toHaveLength(1);
    expect(
      runtime
        .view()
        .objects("command")
        .map((command) => command.data.command),
    ).toEqual(["ls"]);
    expect(status.pendingApprovals.length).toBeGreaterThan(0);
  });

  test("under approveCommands nothing runs until the gate is released", async () => {
    const { calls, tools } = recordingTools();
    const { runtime, status } = await runAgent({
      tools,
      llm: planThenDone(),
      config: { ...config, approveCommands: true },
    });

    // The plan exists and is readable; the shell has seen none of it.
    expect(runtime.view().objects("task")[0]?.data.summary).toBe("Add a greeting");
    expect(runtime.view().objects("command")).toEqual([]);
    expect(calls).toEqual([]);
    expect(status.pendingApprovals.length).toBeGreaterThan(0);
    const proposed = runtime
      .log()
      .filter((event) => (event.type as string) === "approval.proposed")
      .map((event) => (event.payload as { mutation: { data?: { command?: string } } }).mutation)
      .flatMap((mutation) => (mutation.data?.command === undefined ? [] : [mutation.data.command]));
    expect(proposed).toEqual(["ls", "printf hello"]);

    // Released in proposal order, so each command lands before its relation.
    for (const approvalId of status.pendingApprovals) {
      unwrap(await runtime.grantApproval(approvalId));
    }
    const released = unwrap(await runtime.runUntilIdle());

    expect(released.pendingApprovals).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(runtime.view().objects("task")[0]?.data.status).toBe("completed");
    expect(failures(runtime)).toEqual([]);
  });

  test("without a sampled workspace the agent refuses to run commands", async () => {
    const { calls, tools } = recordingTools();
    const { runtime } = await runAgent({ tools, llm: planThenDone(), workspace: null });

    expect(calls).toEqual([]);
    expect(runtime.view().objects("command")[0]?.data.output).toContain("No workspace");
    expect(runtime.view().objects("task")[0]?.data.status).toBe("failed");
  });
});
