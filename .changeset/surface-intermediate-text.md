---
"@glrs-dev/glrs": patch
---

Surface the model's intermediate prose. A turn used to show only the final text; if the model wrote something (e.g. an explanation) in an earlier step alongside its tool calls and then a shorter closing message, that earlier text was dropped — which is why a response could refer to "my previous message" you never saw. Each step's assistant text now streams into the transcript as it lands (the final text isn't duplicated). Turns where the model only speaks at the end are unchanged.
