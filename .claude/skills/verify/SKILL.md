---
name: verify
description: Drive the glorious TUI end-to-end and capture what it paints — build/launch/drive recipe for verifying chat and progress-rendering changes at the real terminal surface.
---

# Verifying glorious at the TUI surface

## Launch

- The chat TUI is `bun <repo>/v2/index.ts` from inside any git repo.
  (`bin/glorious` and `bun run glorious` both exec exactly that.)
- **Try `-p` first.** `bun <repo>/v2/index.ts -p "<prompt>"` runs one turn headless: assistant
  text on stdout, one line per tool call on stderr, no alternate screen. It loads extensions and
  skills exactly as the TUI does, so anything not about *painting* is far cheaper to check there
  than through expect. Reach for the pty only when the question is what the terminal shows.
- Credentials come from env: `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY`
  (first set wins) and `AZURE_RESOURCE_NAME`. On this machine `AZURE_OPENAI_API_KEY` and
  `AZURE_RESOURCE_NAME` are already in the login environment, so no setup is needed.
- `GLORIOUS_MODEL` overrides the model (default `gpt-5.6-luna`); `GLORIOUS_VARIANT` the effort.
- Sessions are plain JSON now — no Keychain, nothing to disable before a driven run.
- Make a throwaway target repo in the scratchpad (`git init` + a couple of files) so the agent's
  edits and commands land somewhere disposable. Note this does *not* isolate sessions — those are
  global, see cleanup below.
- Long multi-step turns intermittently die with `Item with id 'rs_…' not found` — an Azure
  Responses API error about reasoning-item retention, seen through both `-p` and the TUI. Re-run
  before believing a failure is yours.
- A missing key fails fast with a one-line error before the alternate screen opens — that itself is a testable path.

## Drive it (no tmux on this machine; screen's hardcopy writes empty files)

Use `/usr/bin/expect` with a stream log. Two gotchas, both fatal:

- expect's `sleep` does not read the pty — output stalls and nothing is logged. Pump instead:
  `proc pump {secs} { expect -timeout $secs -re {ZZZ_NEVER_MATCHES_ZZZ} }`
- Under a non-tty parent the spawned pty is 0×0 and the live region (editor, progress block, status bar) is never painted. After `spawn`:
  `stty rows 50 columns 200 < $spawn_out(slave,name)`

Keys: `\r` submits, `\x1b` (Esc) dequeues the newest queued message or interrupts the turn, `\x03` (Ctrl-C) clears the composer / once-on-empty interrupts / twice quits.

After the app quits, the trailing `expect eof` reports `spawn id ... not open` and expect exits 1.
That is the normal ending, not a failure — judge the run by the capture.

## Probe prompts

- One tool call plus assistant text, the whole render pipeline in one turn (~10s, small token cost):
  "Read hello.txt with your tools and reply with its exact contents followed by the word VERIFY-OK".
- Ordering and the progress block: "In one short sentence say what you are about to do, then run
  the bash command 'sleep 3', then read hello.txt, then reply with its exact contents and the word
  VERIFY-OK". The preamble must land above the tool rows it announces, and `sleep 3` outlives the
  250ms settle so the running row actually paints. A 1ms `read` never shows one — if you only probe
  fast tools you are not testing the progress block at all.

## Read the capture

Strip ANSI: `perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g; s/\e\][^\a]*\a//g; s/\r//g'`.
The cleaned stream is a time-series of live-region repaints; transcript lines appear once in write
order. On exit the transcript replays into normal scrollback — the clean copy at the end of the
capture is the one to read. Squeezing runs of spaces into newlines makes it legible:
`tail -c 3000 clean.log | perl -pe 's/ {3,}/\n/g'`.

Grep anchors that hold up:

- `❯` echoed user turn · `●` assistant block · `✓` finished tool row · `Ctrl+C again to exit` quit
  ladder · `Continue with: glorious --resume <id>` the exit line.
- Finished rows read `✓ <tool>  <detail>  <elapsed>`, e.g. `✓ read  hello.txt  1ms`. Tool names are
  bash, read, write, edit, grep, glob, ask_user, the conditional activate_skill, and whatever
  extensions have registered (`web_fetch` ships bundled).
- Running rows are `→ <tool> <detail>`, live-region only — they never reach the transcript.
  An extension's `renderCall` replaces the text after the mark, not the mark itself.

Do not grep for `ctx`. The status line does render `ctx <tokens>`, but interleaved repaints shred it
mid-string and it matched zero times across runs. The literal `Esc interrupt` is the reliable
busy-state anchor — and since nothing animates any more, `█` or `▁` appearing anywhere in a capture
means the sweep block or the VU meter has come back.

## Clean up

Sessions are written to `$XDG_DATA_HOME/glorious/sessions` (default `~/.local/share/glorious/sessions`),
keyed by session id — never inside the target repo. Each driven run leaves one behind. The exit line
prints the id, so delete `<id>.json` there when finished.
