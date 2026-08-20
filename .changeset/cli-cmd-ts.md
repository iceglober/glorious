---
"@glrs-dev/glrs": minor
---

`glrs --help` exists, and a flag's value is no longer whatever token sat beside it.

argv was read by index arithmetic inside `main()`, and every bug it had came from one root. `--model -p hi` set the model to `"-p"` and ran headless anyway. `--resume --model x` looked for a session called `--model`. A trailing `--model` was dropped in silence and started an ordinary session. `--Foo` disappeared without even the `(unknown flag:)` line, because the scan was `/^--([a-z][a-z0-9-]*)$/u` and never matched a capital. And `-p` was matched wherever it appeared, so `glrs wt -p hi` ran a headless turn and threw the subcommand away.

cmd-ts owns glrs's own surface now. Unknown flags and missing values are rejected by construction; the two it does not catch — a value that is really the next flag, and a model id naming no provider — are expressed as a cmd-ts type, so `--model` refuses `-p` and refuses `gpt-5` with a sentence saying why.

**cmd-ts cannot own the whole tree, and does not.** A subcommand an extension added is not known until extensions load, and glrs deliberately does not load them for a bare `glrs`, a `-p` run or `glrs doctor`. So the first bare word is classified before parsing, and only a word glrs does not claim reaches the extension host. Whichever of `-p` and a bare word comes first now wins, which is what makes `glrs wt -p hi` the worktree subcommand and `glrs -p what failed` a prompt rather than a subcommand called `failed`.

`--help` is the one route that loads extensions, because help that omitted `glrs wt` would be help that lies — the specs are read from what each extension registered rather than written down twice. `--version` and `--help` also stopped requiring that they be the only argument.

Errors arrive as one sentence. cmd-ts reports through a coloured multi-line block meant for a terminal; the offending fragment and the reason are lifted out of it, so a parse failure reads like everything else glrs writes to stderr.
