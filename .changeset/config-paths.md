---
"@glrs-dev/glrs": minor
---

Read personal config from `~/.glorious/config.json` as well.

Extensions and commands already come from `~/.glorious/` — the ancestor walk reaches it whenever a project sits under home — but config was read only from the project and `~/.config/glorious/`. The same directory holding your resources but not your settings is a rule nobody should have to learn. Both personal locations are now read, merged nearest-first one key at a time, so a project can pin the model while your personal config supplies the provider settings it does not mention.

Also fixes a lint error that reached main: a regex written with a literal escape character, in the test that tolerates ANSI in a child process's output.
