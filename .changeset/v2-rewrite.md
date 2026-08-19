---
"@glrs-dev/glrs": major
---

Replace the implementation with a ground-up rewrite in `v2/`, and delete `core/`.

Same product — a barebones chat TUI over an agent with core tools — in 1,165 lines
across seven files instead of 4,382. The TUI is unchanged to look at: the `❯` user
band, `●` assistant blocks, live tool sweep, VU meter, queue and interrupt ladder,
and scrollback replay on exit all behave as before.

What changed under it:

- **Tools** are now `bash`, `read`, `write`, `edit`, `grep`, `glob`, all defined
  against one `Bun.spawn` helper. A killed or failed tool now freezes into the
  transcript as a red `✗` instead of a green `✓`.
- **Assistant text now prints before the tools it announces.** Previously a
  preamble was emitted at step end, so it landed underneath the tool rows it was
  describing.
- **Gone:** the LLM port/adapter split, the sandbox and workspace port layers,
  prompt profiles and their template engine, the output spill store, context
  compaction, and the three interchangeable edit modes.
- **Breaking:** there is no CLI argument parsing. `glorious --help` and
  `glorious --version` no longer exist; running `glorious` opens a chat session.
  The generated command-line reference is dropped from the docs with it.
