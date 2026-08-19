---
"@glrs-dev/glrs": patch
---

Give model responses their own visual anchor in the transcript. User turns lead with `❯` and tool rows with `✓`, but the assistant's prose had no marker and read as loose text between the activity rows. Responses now lead with a `●` accent marker on their first line, so the model's answer stands out as a distinct block.
