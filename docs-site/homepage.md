# glrs

a model, a turn loop, and a set of extensions over a git repository.

```bash
curl -fsSL https://glrs.dev/install.sh | bash
glrs --model anthropic/claude-opus-5
```

the core registers no commands and one tool. the file and shell tools, every
slash command, the question widget and git worktrees all arrive as extensions,
through the same API anyone can write against.


## tutorials

- [quick start](../docs/published/1-tutorials/1-quick-start.md)
- [your first extension](../docs/published/1-tutorials/2-first-extension.md)
- [have glrs write the extension](../docs/published/1-tutorials/3-self-authoring.md)

## how-to guides

- [install & update](../docs/published/2-how-to/1-install-and-update.md)
- [connect a provider](../docs/published/2-how-to/2-connect-a-provider.md)
- [resume and fork](../docs/published/2-how-to/3-resume-and-fork.md)
- [write a command](../docs/published/2-how-to/4-write-a-command.md)
- [write a skill](../docs/published/2-how-to/5-write-a-skill.md)
- [set project rules](../docs/published/2-how-to/6-set-project-rules.md)
- [manage extensions](../docs/published/2-how-to/7-manage-extensions.md)
- [turn things off](../docs/published/2-how-to/8-turn-things-off.md)
- [run in a pipeline](../docs/published/2-how-to/9-run-in-a-pipeline.md)

## explanation

- [design](../docs/published/3-explanation/1-design.md)
- [a turn](../docs/published/3-explanation/2-a-turn.md)

## reference

- [cli](../docs/published/9-reference/1-cli.md)
- [rules](../docs/published/9-reference/10-rules.md)
- [extensions](../docs/published/9-reference/11-extensions.md)
- [events](../docs/published/9-reference/12-events.md)
- [subcommands](../docs/published/9-reference/13-subcommands.md)
- [configuration](../docs/published/9-reference/14-configuration.md)
- [the tui](../docs/published/9-reference/2-tui.md)
- [keys](../docs/published/9-reference/3-keys.md)
- [models](../docs/published/9-reference/4-models.md)
- [sessions](../docs/published/9-reference/5-sessions.md)
- [turns](../docs/published/9-reference/6-turns.md)
- [tools](../docs/published/9-reference/7-tools.md)
- [commands](../docs/published/9-reference/8-commands.md)
- [skills](../docs/published/9-reference/9-skills.md)
