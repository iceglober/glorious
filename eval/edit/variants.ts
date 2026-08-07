import { randomUUID } from "node:crypto";
import { chmod, rename, rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

// The edit strategies under test. `batch` mirrors v2/tools.ts exactly — the
// variant the 2026 study picked. `multi` is the untested extension: one call
// carrying edits for several files, resolved everywhere before anything lands.

const swap = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

type Swap = z.infer<typeof swap>;

const patch = (text: string, edit: Swap, where: string, batched: boolean): string => {
  const at = text.indexOf(edit.old_string);
  if (at < 0)
    throw new Error(
      `${where}: old_string not found${batched ? ", after the earlier edits in this call were applied" : ""}. Nothing was written. Re-read the file.`,
    );
  if (edit.replace_all) return text.split(edit.old_string).join(edit.new_string);
  const hits = text.split(edit.old_string).length - 1;
  if (hits > 1)
    throw new Error(
      `${where}: old_string occurs ${hits} times. Nothing was written. Add surrounding lines to make it unique, or set replace_all.`,
    );
  return text.slice(0, at) + edit.new_string + text.slice(at + edit.old_string.length);
};

const replaceFile = async (target: string, text: string): Promise<void> => {
  const temp = `${target}.eval-${randomUUID().slice(0, 8)}`;
  try {
    await Bun.write(temp, text);
    await chmod(temp, (await stat(target)).mode);
    await rename(temp, target);
  } catch (thrown) {
    await rm(temp, { force: true }).catch(() => {});
    throw thrown;
  }
};

export type Variant = "batch" | "multi";

export const createEditTool = (
  root: string,
  variant: Variant,
  onCall: () => void,
): ToolSet["edit"] => {
  const base = resolve(root);
  const within = (target: string): string => {
    const full = resolve(base, target);
    if (full === base || full.startsWith(`${base}${sep}`)) return full;
    throw new Error(`path escapes root: ${target}`);
  };

  const applyOne = async (path: string, edits: Swap[], label: string): Promise<string> => {
    const target = within(path);
    const before = await Bun.file(target).text();
    const after = edits.reduce(
      (text, edit, n) => patch(text, edit, `${label}edit ${n + 1}/${edits.length}`, n > 0),
      before,
    );
    await replaceFile(target, after);
    return after;
  };

  if (variant === "batch")
    return tool({
      description:
        "Change a file with exact string replacements applied in order, each against the result of the previous one. Every old_string must match exactly, whitespace included, and occur exactly once unless replace_all is set — add surrounding lines to make it unique. Every edit is resolved before anything is written, so a failure leaves the file untouched. Never include the `N|` prefixes shown by read.",
      inputSchema: z.object({
        path: z.string().describe("File to edit, relative to the project root or absolute"),
        edits: z.array(swap).min(1),
      }),
      execute: async ({ path, edits }) => {
        onCall();
        try {
          await applyOne(path, edits, "");
          return `applied ${edits.length} edit(s) to ${path}`;
        } catch (thrown) {
          return `ERROR: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
        }
      },
    });

  return tool({
    description:
      "Change one or more files in a single call. Each entry names a file and the exact string replacements to apply to it, in order, each against the result of the previous one. Every old_string must match exactly, whitespace included, and occur exactly once unless replace_all is set. Every edit in every file is resolved before anything is written, so if one fails no file is changed. Prefer one call covering all the files you need to touch. Never include the `N|` prefixes shown by read.",
    inputSchema: z.object({
      files: z
        .array(z.object({ path: z.string(), edits: z.array(swap).min(1) }))
        .min(1)
        .describe("Files to change, each with its own edits"),
    }),
    execute: async ({ files }) => {
      onCall();
      try {
        // resolve everything first, so one bad edit cannot leave the tree
        // half-changed the way separate per-file calls would
        const staged: Array<{ target: string; text: string }> = [];
        for (const [n, entry] of files.entries()) {
          const target = within(entry.path);
          const before = await Bun.file(target).text();
          const label = `file ${n + 1}/${files.length} (${entry.path}) `;
          const after = entry.edits.reduce(
            (text, edit, i) =>
              patch(text, edit, `${label}edit ${i + 1}/${entry.edits.length}`, i > 0),
            before,
          );
          staged.push({ target, text: after });
        }
        for (const { target, text } of staged) await replaceFile(target, text);
        const count = files.reduce((sum, entry) => sum + entry.edits.length, 0);
        return `applied ${count} edit(s) across ${files.length} file(s)`;
      } catch (thrown) {
        return `ERROR: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
      }
    },
  });
};
