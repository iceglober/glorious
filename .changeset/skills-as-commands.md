---
"@glrs-dev/glorious": patch
---

Make every skill a slash command, and say so when a command does not exist.

- **A skill is reachable under its own name.** Commands were granted only to skills declaring a `trigger:` in their frontmatter, so a skill that dropped the field lost its command with no warning — which is what happened when graphify shipped 0.9.41 without one, taking `/graphify` with it. Every skill now has a command named after it; `trigger:` only renames it.
- **An unknown slash command is reported.** Any `/word` was treated as a command, which cleared the composer and then matched nothing, so the message vanished and no turn ran. A command that does not exist now says so instead of swallowing the input.
