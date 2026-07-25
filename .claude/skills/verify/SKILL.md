---
name: verify
description: Drive the glorious TUI end-to-end and capture what it paints — build/launch/drive recipe for verifying chat and progress-rendering changes at the real terminal surface.
---

# Verifying glorious at the TUI surface

## Launch

- The only command is the chat TUI: `bun <repo>/core/agent-loop.ts` from inside any git repo.
- Credentials come from env: `AZURE_FOUNDRY_API_KEY` (or `AZURE_API_KEY`) and `AZURE_RESOURCE_NAME`.
  On this machine the key lives in the keychain from an older build:
  `export AZURE_FOUNDRY_API_KEY=$(security find-generic-password -s glorious -a azure-api-key -w)`;
  `AZURE_RESOURCE_NAME` is already exported in the login environment.
- `GLORIOUS_MODEL` overrides the model (default `gpt-5.6-luna`).
- Make a throwaway target repo in the scratchpad (`git init` + a couple of files) so chat sessions don't pollute a real project.
- A missing key fails fast with a one-line error before the alternate screen opens — that itself is a testable path.

## Drive it (no tmux on this machine; screen's hardcopy writes empty files)

Use `/usr/bin/expect` with a stream log. Two gotchas, both fatal:

- expect's `sleep` does not read the pty — output stalls and nothing is logged. Pump instead:
  `proc pump {secs} { expect -timeout $secs -re {ZZZ_NEVER_MATCHES_ZZZ} }`
- Under a non-tty parent the spawned pty is 0×0 and the live region (editor, progress block, status bar) is never painted. After `spawn`:
  `stty rows 50 columns 200 < $spawn_out(slave,name)`

Keys: `\r` submits, `\x1b` (Esc) dequeues the newest queued message or interrupts the turn, `\x03` (Ctrl-C) clears the composer / once-on-empty interrupts / twice quits.

A prompt like "Read hello.txt with your tools and reply with its exact contents followed by the word VERIFY-OK" forces one tool call plus assistant text — the whole render pipeline in one turn (~10s, small token cost).

## Read the capture

Strip ANSI: `perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g; s/\e\][^\a]*\a//g; s/\r//g'`.
The cleaned stream is a time-series of live-region repaints; transcript lines (`printAbove`) appear once in write order. Grep anchors: `❯` (echoed user turn), `✓ readFile` (frozen tool row), `●` (assistant block), `ctx` (status bar), `▁▂▇█` (busy VU meter), `Ctrl+C again to exit` (quit ladder). On exit the transcript replays into normal scrollback — the clean copy at the end of the capture.
