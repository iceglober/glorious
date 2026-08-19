---
"@glrs-dev/glrs": patch
---

Fix two faults in user-defined slash commands, both hit the first time one was run for real.

- **The expansion was echoed as the user's own message.** A skill trigger expands to tens of thousands of characters, so running one filled the transcript with the skill file instead of the single line that was typed. The transcript now shows the command as typed; the model still receives the full expansion.
- **A triggered skill did not run.** It arrived as a bare `<skill_content>` block, which reads as reference material rather than as something to carry out — the agent replied asking what to work on and fell through to the repository's own rules. It now arrives framed as an instruction to run the skill.
- Arguments appended to a body with no placeholder are marked as arguments, so a bare `.` trailing 32kB of instructions is no longer indistinguishable from a stray character.
