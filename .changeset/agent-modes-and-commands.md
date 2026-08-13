---
"@glrs-dev/glorious": minor
---

Add agent modes, plan approval, and user-defined slash commands.

- **Modes.** A mode is a capability preset — which tools the agent may reach for, and how hard it is asked to think — layered on whatever model is active, so `/models` stays orthogonal. `build` restricts nothing; `plan` is read-only and asks for high reasoning effort where the model offers it. `/mode` opens a picker and Tab cycles. The active mode is a coloured label under the composer rather than a line in the status footer.
- **Read-only is enforced, not requested.** In plan mode the restricted tools are absent from the toolset rather than forbidden in the prompt. `bash` is withheld because `ls` and `rm -rf` are indistinguishable before running them. MCP tools opt in per server via a `readOnly` list; an undeclared tool is withheld rather than guessed at.
- **Plan approval.** A plan-mode turn ends by presenting its plan for approval, in the composer. Approve and implement from a fresh context, approve and keep the conversation, or reply with feedback and have it revised. Approving switches to build mode and runs the plan as its own turn. Clearing resets what the model sees, not what you see: the transcript keeps every line, and a resumed session inherits the same trimmed context.
- **`/clear`** drops the conversation the model replays while keeping the transcript. It refuses mid-turn, when the running request would otherwise overwrite the clear as it lands.
- **User-defined slash commands.** Markdown files in `.glorious/commands`, `.agents/commands` or `.claude/commands` — walking up from the project, then the home directory — become slash commands, as do skills that declare a `trigger:` in their frontmatter. Both expand `$ARGUMENTS` and `$1`–`$9`, and a body with no placeholder still receives the arguments. Built-in commands win name collisions.
- **Questions and menus render in the composer** instead of as panels over the transcript. A question is the input area asking rather than waiting, so it takes the composer's place; help, skills, MCP and the model pickers do the same, and gain room now that they spend no space on a border.
