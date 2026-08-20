import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Config } from "../../provider-registry/src";

// The one thing in glrs that writes your configuration, and it does nothing
// unless you have said it may. `config.ts` opens with "nothing writes config at
// runtime any more — you edit the file", and that stays true by default: this
// runs only for sections named in `agentConfigAllowlist`.
//
// What it is for is narrow. The agent can suggest turning on an extension the
// work needs; without somewhere to record your answer, a decline lasts until
// the next turn and you are asked the same question forever.

/** Result of attempting an allowlisted Project-config update. */
export type WriteOutcome = "written" | "not-allowed" | "already" | "failed";

const permitted = (config: Config, section: string): boolean =>
  (config.agentConfigAllowlist ?? []).some((one) => one.trim().toLowerCase() === section);

// The project file, which is the one a person looking for their settings opens.
// Deliberately not `config.local.json`: a decision about which extensions this
// project uses belongs with the project, and the `.local.` file is the one you
// do not commit.
const target = (root: string): string => join(root, ".glrs", "config.json");

const readRaw = async (path: string): Promise<Record<string, unknown>> => {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A file that is not JSON is one a person is midway through editing.
    // Rewriting it would throw their work away.
    return {};
  }
};

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];

// Adds `name` to one of the two extension lists and removes it from the other,
// so answering the opposite way later actually changes the answer. Every other
// key in the file is read and written back untouched — but formatting and
// comments do not survive a JSON round-trip, which is worth knowing if you
// hand-format the file.
export const recordExtensionChoice = async (
  root: string,
  config: Config,
  name: string,
  on: boolean,
): Promise<WriteOutcome> => {
  if (!permitted(config, "extensions")) return "not-allowed";
  const path = target(root);
  const raw = await readRaw(path);
  const block =
    typeof raw.extensions === "object" && raw.extensions !== null && !Array.isArray(raw.extensions)
      ? { ...(raw.extensions as Record<string, unknown>) }
      : {};
  const load = listOf(block.load);
  const disable = listOf(block.disable);
  const [into, outOf] = on ? [load, disable] : [disable, load];
  const already = into.includes(name) && !outOf.includes(name);
  if (already) return "already";
  block.load = on ? [...new Set([...load, name])] : load.filter((one) => one !== name);
  block.disable = on ? disable.filter((one) => one !== name) : [...new Set([...disable, name])];
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ ...raw, extensions: block }, null, 2)}\n`, "utf8");
    return "written";
  } catch {
    return "failed";
  }
};
