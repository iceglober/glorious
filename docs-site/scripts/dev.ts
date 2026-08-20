import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

const site = join(import.meta.dir, "..");
const root = join(site, "..");
const watched = [
  join(root, "docs", "published"),
  join(root, "packages", "glrs-core", "src"),
  join(root, "packages", "glrs-coding-agent", "src", "sdk.ts"),
  join(root, "packages", "provider-registry", "src"),
  join(site, "homepage.md"),
  join(site, "api"),
  join(site, "plugins"),
  join(site, "public"),
  join(site, "scripts"),
  join(site, "theme"),
  join(site, "typedoc.json"),
];

const build = async (): Promise<boolean> => {
  const process = Bun.spawn(["bun", "scripts/build.ts"], {
    cwd: site,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await process.exited) === 0;
};

if (!(await build())) process.exit(1);
const server = Bun.spawn(["bun", "scripts/serve.ts"], {
  cwd: site,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

let timer: ReturnType<typeof setTimeout> | undefined;
let building = false;
let queued = false;
const rebuild = async (): Promise<void> => {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  console.log("\nchange detected — rebuilding TypeDoc…");
  if (await build()) {
    await fetch("http://127.0.0.1:4180/__notify_reload", { method: "POST" }).catch(() => {});
    console.log("documentation rebuilt; browsers reloaded");
  }
  building = false;
  if (queued) {
    queued = false;
    await rebuild();
  }
};
const changed = (): void => {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 120);
};
const watchers: FSWatcher[] = watched
  .filter(existsSync)
  .map((path) => watch(path, { recursive: statSync(path).isDirectory() }, changed));

const stop = (): void => {
  for (const watcher of watchers) watcher.close();
  server.kill();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.exitCode = await server.exited;
