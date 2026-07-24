---
"@glrs-dev/glorious": patch
---

Refresh the chat TUI's live animations and transcript hierarchy. The running-tool indicator is now a side-to-side sweep — a short bar that grows from one edge, slides across as it empties, then does the same from the other side — instead of a single cell growing and shrinking in place, and it animates on the fast frame (~90ms) for snappier motion. Background-job rows now show a spinning quadrant dial (◴◷◶◵) instead of the same bar, also on the fast frame. In the transcript, a background job's "started" line is indented and muted so it groups with the tool activity under the turn, leaving the assistant's prose flush-left as the primary content; a job's finish line gets a blank line above it to separate its result from the activity above.
