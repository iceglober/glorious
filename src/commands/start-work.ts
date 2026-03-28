import { command } from "cmd-ts";
import { App } from "../tui/app.js";

export const startWork = command({
  name: "start",
  description: "Launch the work management TUI — manage backlog, run parallel Claude sessions",
  args: {},
  handler: () => {
    // The Claude Agent SDK spawns subprocesses and writes to their stdin.
    // If a subprocess exits unexpectedly, the write throws EPIPE as an
    // unhandled 'error' event on the Socket, which crashes the process.
    // Catch these at the process level so the TUI stays alive.
    process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return; // swallow — session error handler picks it up
      // Re-throw anything else
      throw err;
    });

    const app = new App();
    app.start();
  },
});
