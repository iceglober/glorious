const port = 4174;
const url = `http://127.0.0.1:${port}/?edit=1`;

const openBrowser = (): void => {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
};

const alreadyRunning = await fetch(url).then((response) => response.ok).catch(() => false);
if (alreadyRunning) {
  console.log(`docs editor already running at ${url}`);
  openBrowser();
  process.exit(0);
}

const child = Bun.spawn(
  ["bunx", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, GLORIOUS_EDIT: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

const stop = (): void => child.kill();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

for (let attempt = 0; attempt < 50; attempt += 1) {
  const ready = await fetch(url).then((response) => response.ok).catch(() => false);
  if (ready) {
    console.log(`opening visual editor: ${url}`);
    openBrowser();
    break;
  }
  await Bun.sleep(100);
}

process.exitCode = await child.exited;
