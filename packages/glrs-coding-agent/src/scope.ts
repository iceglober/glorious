import { homedir } from "node:os";
import { join } from "node:path";
import type { Scope } from "../../glrs-core/src";
import { docsPath } from "./prompt";

// What this session considers in scope beyond the project root. The policy is
// the host's because only the host knows where its own documentation and
// configuration live; the enforcing is a tool's, and since the tools are an
// extension now it is enforcing you can replace. Worth saying plainly: path
// confinement is a guard against the model wandering, not a boundary against
// an adversary. `bash` has never been confined at all.

// Where glrs keeps your extensions, skills and commands. The docs tell the
// model to write an extension to ~/.config/agents/extensions — and `write`
// refused, because the path is outside the project. The model then wrote it
// with a python heredoc through `bash`, which is unconfined, so the guard
// bought nothing and cost a ✗ row and a clumsier path.
//
// The grant is the resources themselves, not the directories that hold them.
// It used to be the whole of `~/.glorious` and `~/.agents`, which was harmless
// only because nothing else lived there. `~/.glrs` is somewhere people keep
// checkouts, and a blanket grant would let `write` leave the project root and
// land in an unrelated repository.
const agentResources = (): string[] => {
  const home = homedir();
  const roots = [
    join(home, ".config", "agents"),
    join(home, ".agents"),
    join(home, ".glrs"),
    join(home, ".config", "glrs"),
    join(home, ".glorious"),
    join(home, ".config", "glorious"),
  ];
  return roots.flatMap((root) => [
    join(root, "extensions"),
    join(root, "skills"),
    join(root, "commands"),
    join(root, "config.json"),
    join(root, "config.local.json"),
  ]);
};

// Reads reach one place writes do not: glrs's own documentation. The system
// prompt hands the model an absolute path to it and tells it to read it;
// confining reads to the project root made that instruction false everywhere
// except inside the glrs repo itself, and the model routed around it with
// `bash cat` — a wasted step and a ✗ row about a file that was there all along.
export const sessionScope = (): Scope => {
  const write = agentResources();
  return { write, read: [...write, docsPath()] };
};
