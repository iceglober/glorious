---
"@glrs-dev/glrs": minor
---

glorious is glrs, everywhere, and everything it wrote under the old name is still read.

The docs site has been glrs.dev since it went up, and a real 1.0 is close enough that a rename after it would be a migration rather than a rename. So: the published package is `@glrs-dev/glrs`, the command is `glrs`, the internal packages are `@glrs-dev/glrs-core` and `@glrs-dev/glrs-coding-agent`, the extension API type is `Glrs`, and the agent introduces itself as glrs. First-party extension packages take a `glrs-ext-` prefix — `@glrs-dev/glrs-ext-builtins`, `-ask-user`, `-web-fetch` — so a package's kind is legible from its name once third parties publish alongside them.

Nothing you already have stops working. `.glorious/` is read everywhere `.glrs/` is and `GLORIOUS_<name>` everywhere `GLRS_<name>` is, both at lower precedence, so a checkout or a shell profile written before the rename needs no edit. Project config still beats personal config whichever spelling each uses — a project pinning a model in `.glorious/` beats your personal `.glrs/`, because the rename adds a name rather than reordering precedence. Sessions are read from both stores and written to the new one, so resuming an old session migrates it and the old copy is left where it is. The old names will stop being read in a future major version. `glorious` also survives as an alias for the `glrs` command.

**`write` reaches less than it did.** Widening writes past the project root exists so the model can save an extension or a skill to your personal agent directory without being refused. That grant used to be whole directories — all of `~/.glorious`, all of `~/.agents` — which was harmless only because nothing else lived there. `~/.glrs` is somewhere people keep checkouts, so a blanket grant would have let `write` leave one project and land in another. The grant is now the resources it was always about: `extensions/`, `skills/`, `commands/`, and `config.json` under each of those roots.

Three things that had no tests now do, because the rename is exactly the kind of change that breaks them silently: the old config directory and environment variables still being read, the session store spanning both directories without listing a resumed session twice, and the write grant covering the resource directories and nothing around them. Session storage was untestable before this — the directories were module-level constants read at import, so pointing them somewhere disposable was impossible — and is computed per call now.

One test was passing for the wrong reason and is fixed here: it asserted a file's contents were readable with `toContain("probe")` against a file named `zz-read-probe.txt`, so the refusal message — which quotes the path it refused — satisfied the assertion just as well as the file did.
