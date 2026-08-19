import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, saveSession, sessionFile } from "./session";

// Sessions are the one thing here that is genuinely the user's data: lose the
// directory and you lose every transcript. The rename moved where they are
// written, so the old location is still read and a session resumed from it is
// saved to the new one — the store migrates itself, one session at a time,
// with nothing to move by hand.
//
// None of this had a test before, because the directories were module-level
// constants read from XDG_DATA_HOME at import. They are computed per call now,
// which is what lets this point them somewhere disposable.

const homes: string[] = [];
const original = process.env.XDG_DATA_HOME;

const store = async (): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), "glrs-sessions-"));
  homes.push(home);
  process.env.XDG_DATA_HOME = home;
  return home;
};

const put = async (home: string, dir: string, id: string, updatedAt: string): Promise<void> => {
  await mkdir(join(home, dir, "sessions"), { recursive: true });
  await writeFile(
    join(home, dir, "sessions", `${id}.json`),
    `${JSON.stringify({
      schema: 2,
      id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
      cwd: "/tmp",
      events: [{ type: "user", text: `from ${dir}` }],
    })}\n`,
  );
};

beforeEach(() => {
  process.env.XDG_DATA_HOME = original;
});

afterAll(async () => {
  if (original === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = original;
  for (const home of homes) await rm(home, { recursive: true, force: true });
});

describe("sessions written before the rename", () => {
  test("a session in the old directory is still listed", async () => {
    const home = await store();
    await put(home, "glorious", "old-one", "2026-01-02T00:00:00.000Z");
    const listed = await listSessions();
    expect(listed.map((one) => one.id)).toEqual(["old-one"]);
  });

  test("both directories are listed together, newest first", async () => {
    const home = await store();
    await put(home, "glorious", "older", "2026-01-01T00:00:00.000Z");
    await put(home, "glrs", "newer", "2026-01-03T00:00:00.000Z");
    const listed = await listSessions();
    expect(listed.map((one) => one.id)).toEqual(["newer", "older"]);
  });

  // A session resumed from the old directory is saved to the new one, so for a
  // while it exists in both. Listing it twice would make a half-migrated store
  // look like it had duplicated every session anyone resumed.
  test("a session present in both is listed once, from the new directory", async () => {
    const home = await store();
    await put(home, "glorious", "both", "2026-01-01T00:00:00.000Z");
    await put(home, "glrs", "both", "2026-01-05T00:00:00.000Z");
    const listed = await listSessions();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.updatedAt).toBe("2026-01-05T00:00:00.000Z");
  });

  test("no store at all is no sessions, not a failure", async () => {
    await store();
    expect(await listSessions()).toEqual([]);
  });
});

describe("where a session's file is", () => {
  test("a session only in the old directory reports the old path", async () => {
    const home = await store();
    await put(home, "glorious", "old-one", "2026-01-01T00:00:00.000Z");
    expect(sessionFile("old-one")).toBe(join(home, "glorious", "sessions", "old-one.json"));
  });

  test("once it exists in the new directory, that is the one reported", async () => {
    const home = await store();
    await put(home, "glorious", "both", "2026-01-01T00:00:00.000Z");
    await put(home, "glrs", "both", "2026-01-05T00:00:00.000Z");
    expect(sessionFile("both")).toBe(join(home, "glrs", "sessions", "both.json"));
  });

  test("one that does not exist yet reports the new directory", async () => {
    const home = await store();
    expect(sessionFile("brand-new")).toBe(join(home, "glrs", "sessions", "brand-new.json"));
  });
});

describe("resuming a session written before the rename", () => {
  // The migration itself: read from the old directory, saved into the new one.
  test("saving it puts it in the new directory and leaves the old copy alone", async () => {
    const home = await store();
    await put(home, "glorious", "moving", "2026-01-01T00:00:00.000Z");
    const [session] = await listSessions();
    expect(session).toBeDefined();
    if (session === undefined) return;

    await saveSession({ ...session, updatedAt: "2026-02-01T00:00:00.000Z" });

    expect(await Bun.file(join(home, "glrs", "sessions", "moving.json")).exists()).toBe(true);
    // Left where it was rather than deleted: nothing here destroys a transcript.
    expect(await Bun.file(join(home, "glorious", "sessions", "moving.json")).exists()).toBe(true);
    const listed = await listSessions();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});
