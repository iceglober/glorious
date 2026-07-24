---
"@glrs-dev/glorious": patch
---

Remove the completion-grounding gate. It cross-checked a turn's final response against its tool trajectory and, on a mismatch, forced a corrective retry — but its "claimed active deferred work" heuristic matched a model merely *describing* the background-job capability (an answer mentioning "run background jobs, like waiting for CI or code reviews" read as a claim of active monitoring), then forced `run_background_job`, starting a pointless job. Since a runtime `requiredFirstTool` can't be overridden by the prompt, this fired regardless of guidance. The gate is gone; turns now generate directly. Completion reports still parse and render as before — only the retry/correction machinery is removed.
