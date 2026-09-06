import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import {
  annotateArtifact,
  deleteArtifact,
  listArtifacts,
  readArtifact,
  writeArtifact,
} from "./session";

// What a compaction replaced, kept unchanged. The brief in the conversation is
// lossy on purpose; these are the claim that nothing was actually lost.

let home = "";
let previous: string | undefined;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "glrs-artifacts-"));
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = home;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

const dropped: ModelMessage[] = [
  { role: "user", content: "the login redirect test is failing" },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "t1",
        toolName: "read",
        input: { path: "src/auth/redirect.ts" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "t1",
        toolName: "read",
        output: { type: "text", value: "export const redirect = (url) => url.split('?')[0];" },
      },
    ],
  },
  { role: "assistant", content: "the redirect drops the query string on line 1" },
];

describe("keeping what a compaction replaced", () => {
  test("the messages come back exactly, tool input and output included", async () => {
    const made = await writeArtifact("s1", { label: "fixed the redirect", messages: dropped });
    const body = await readArtifact("s1", made.id);
    expect(body).toContain("the login redirect test is failing");
    expect(body).toContain('"path": "src/auth/redirect.ts"');
    expect(body).toContain("url.split('?')[0]");
    expect(body).toContain("drops the query string on line 1");
  });

  test("the list carries the label, when, and how many messages", async () => {
    const at = new Date("2026-09-06T14:02:11.000Z");
    const made = await writeArtifact("s2", { label: "auth refactor", messages: dropped, now: at });
    const found = await listArtifacts("s2");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: made.id,
      sessionId: "s2",
      label: "auth refactor",
      createdAt: "2026-09-06T14:02:11.000Z",
      messages: 4,
      note: "",
    });
  });

  test("artifacts belong to their session and no other", async () => {
    await writeArtifact("s3", { label: "mine", messages: dropped });
    expect(await listArtifacts("s3")).toHaveLength(1);
    expect(await listArtifacts("s3-not")).toHaveLength(0);
  });

  test("two compactions in one session list oldest first", async () => {
    await writeArtifact("s4", {
      label: "first",
      messages: dropped,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    await writeArtifact("s4", {
      label: "second",
      messages: dropped,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect((await listArtifacts("s4")).map((one) => one.label)).toEqual(["first", "second"]);
  });

  test("a label that spans lines is kept to one, so the list stays a list", async () => {
    const made = await writeArtifact("s5", { label: "two\nlines", messages: dropped });
    expect((await listArtifacts("s5"))[0].label).toBe("two lines");
    expect(await readArtifact("s5", made.id)).not.toStartWith("lines");
  });

  test("relabelling and noting keep the body untouched", async () => {
    const made = await writeArtifact("s6", { label: "before", messages: dropped });
    const before = await readArtifact("s6", made.id);
    expect(
      await annotateArtifact("s6", made.id, { label: "after", note: "the one with the tests" }),
    ).toBe(true);
    const [found] = await listArtifacts("s6");
    expect(found).toMatchObject({ label: "after", note: "the one with the tests" });
    expect(await readArtifact("s6", made.id)).toBe(before);
  });

  test("deleting removes it from the list and the read", async () => {
    const made = await writeArtifact("s7", { label: "gone", messages: dropped });
    expect(await deleteArtifact("s7", made.id)).toBe(true);
    expect(await listArtifacts("s7")).toEqual([]);
    expect(await readArtifact("s7", made.id)).toBeNull();
  });

  test("an id that does not exist is said, not thrown", async () => {
    expect(await readArtifact("s8", "nope")).toBeNull();
    expect(await annotateArtifact("s8", "nope", { label: "x" })).toBe(false);
    expect(await deleteArtifact("s8", "nope")).toBe(false);
  });

  test("an empty label gets a name rather than an empty line", async () => {
    await writeArtifact("s9", { label: "   ", messages: dropped });
    expect((await listArtifacts("s9"))[0].label).toBe("compacted conversation");
  });
});
