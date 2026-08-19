---
"@glrs-dev/glrs": patch
---

Say why a tool call failed.

A failed row read `✗ edit 2 files  24ms` and stopped there. The reason was never hidden from the *model* — it is the tool's return value, and `edit` reports which file and which replacement did not match — but it never reached the transcript. So a failure the agent then worked around looked, from the outside, like nothing had happened, and the only way to find out was to ask the agent what it had just done.

A failed row now carries the reason underneath, clipped to one line:

```
✗ edit  2 files  24ms
    file 2/2 (b.txt) edit 1/1: old_string not found. Nothing was written. Re-read the file.
```

`-p` does the same on the tool trail, so piping to a log no longer loses it. The `ERROR:` prefix is dropped — the `✗` already says that — and a 30k result is clipped rather than pasted into the transcript.

Worth stating, since a failed multi-file edit invites the opposite assumption: no file was written. `edit` resolves every replacement across every file before touching disk, so one bad match leaves the tree exactly as it was, including files whose own edits were fine.
