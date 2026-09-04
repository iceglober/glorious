// Which extensions ship, and turned on or off. The loader is in glrs-core and
// takes this as data: discovery, shadowing and failure isolation are mechanism,
// the roster is a decision about what this product is.

import { join } from "node:path";
import askUser from "../../extensions/ask-user/src";
import builtins from "../../extensions/builtins/src";
import modelPicker from "../../extensions/model-picker/src";
import webFetch from "../../extensions/web-fetch/src";
import worktree from "../../extensions/worktree/src";
import type { ExtensionHost, Registry } from "../../glrs-core/src/extension-api";
import {
  type ExtensionSettings,
  firstPartyExtensions as firstParty,
  loadExtensions as load,
  type Roster,
  resolveExtensions as resolve,
} from "../../glrs-core/src/extensions";
import type { ToolEvent } from "../../glrs-core/src/toolkit";

export type {
  ExtensionLoad,
  ExtensionPlan,
  ExtensionSettings,
  LoadedExtension,
  Planned,
  Roster,
} from "../../glrs-core/src/extensions";
export { skillRootsFor } from "../../glrs-core/src/extensions";

// Every first-party extension loads. Making the agent ask to turn one on put a
// decision in front of the user that they had no way to evaluate: the model
// advertised `web-fetch` before anyone had wanted a web page. Disable what you
// do not want, or shadow it with a file of the same name.
//
// `defaultOn` is the switch that decides it, and every bundled extension sets
// it. An extension named in `extensions.load` loads whatever it says, so the
// field only matters for one that ships turned off, and none does today.
// `summary` is the line `/extensions` prints beside a first-party extension you
// have turned off, so it says what the extension is for and not what it is
// called.
export const bundled: Roster = [
  {
    name: "ask-user",
    origin: "@glrs-dev/glrs-ext-ask-user",
    load: askUser,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "ask-user"),
    summary: "asks the user a multiple-choice question and waits for the answer",
  },
  {
    name: "builtins",
    origin: "@glrs-dev/glrs-ext-builtins",
    load: builtins,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "builtins"),
    summary: "the file, search and shell tools, and every slash command",
  },
  {
    name: "model-picker",
    origin: "@glrs-dev/glrs-ext-model-picker",
    load: modelPicker,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "model-picker"),
    summary: "adds `/model` for choosing the active model and reasoning effort",
  },
  {
    name: "worktree",
    origin: "@glrs-dev/glrs-ext-worktree",
    load: worktree,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "worktree"),
    summary:
      "creates git worktrees, and audits which ones still have sessions working in them; adds `glrs wt`",
  },
  {
    name: "web-fetch",
    origin: "@glrs-dev/glrs-ext-web-fetch",
    load: webFetch,
    defaultOn: true,
    dir: join(import.meta.dir, "..", "..", "extensions", "web-fetch"),
    summary:
      "fetches web pages and returns them as markdown, rendering JavaScript when Chrome is installed",
  },
];

// Two states, not three. Every first-party extension loads, so `extensions.load`
// has nothing left to say here and only `disable` moves anything.

export const firstPartyExtensions = (settings?: ExtensionSettings) => firstParty(bundled, settings);

export const resolveExtensions = (root: string, settings?: ExtensionSettings) =>
  resolve(root, bundled, settings);

export const loadExtensions = (
  root: string,
  registry: Registry,
  host: ExtensionHost,
  onToolEvent: (event: ToolEvent) => void,
  options: { token?: string; settings?: ExtensionSettings } = {},
) => load(root, bundled, registry, host, onToolEvent, options);
