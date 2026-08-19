---
"@glrs-dev/glrs": minor
---

The tools that touch the machine are an extension now, so replacing one is registering its name.

`packages/extensions/builtins` owned seven slash commands and nothing else, while `bash`, `read`, `write`, `edit`, `grep` and `glob` were merged straight into the agent ahead of every extension. So the sentence the extension docs print in bold — *the core registers no slash commands and no tools of its own* — was a claim the code did not support, and the package named `builtins` was the one place the built-ins were not.

They are the `builtins` extension now, registered through `g.tool` exactly as a tool you write is: same wrapper, same gate, same 30k result cap, same rows. `activate_skill` is the one tool the core still registers, because it needs a skill's body and the extension API does not carry one.

Replacing a tool no longer means shadowing anything. A tool name is kept by whoever claims it first and your project is walked before anything shipped, so registering `bash` in `.glrs/extensions/` simply wins. Shadowing by filename still works, but naming a file `builtins.ts` is a blunter instrument than it was — it now costs the six tools as well as the commands and leaves the model unable to do anything, so glrs says so at startup when it happens.

`g.settings()` is new on the extension API, carrying the resolved config so a tool can read `tool_timeout_ms` without importing the coding agent. Provider blocks are deliberately absent: they hold API keys.

**The path check on `read`, `write`, `edit`, `grep` and `glob` is gone.** Relative paths resolve against the project root, absolute paths are taken as given, and nothing is refused. It never bounded what the agent could touch — `bash` sat unconfined beside those five the whole time — so all it did was make the model reach a file the slow way after being told no on the direct one, which is a thing that actually happened and is why `~/.config/agents` was carved out as an exception. glrs runs in YOLO mode by design; this is that, without the theatre.

The move also settled a long-flaky test. `tools.test.ts > gives separate registries distinct event IDs` timed out under load for months because it built two full tool registries and called `loadSkills(process.cwd())` to do it — and passed at all only because this repository happens to ship a skill. It tests two wrapped tools now and runs in a millisecond.
