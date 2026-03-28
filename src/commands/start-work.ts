import { command } from "cmd-ts";
import { App } from "../tui/app.js";

export const startWork = command({
  name: "start-work",
  description: "Launch the work management TUI — manage backlog, run parallel Claude sessions",
  args: {},
  handler: () => {
    const app = new App();
    app.start();
  },
});
