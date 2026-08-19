import { cp } from "node:fs/promises";
import { join } from "node:path";

const site = join(import.meta.dir, "..");
const typedoc = Bun.spawn(["bunx", "typedoc", "--options", "typedoc.json"], {
  cwd: site,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const code = await typedoc.exited;
if (code !== 0) process.exit(code);
await cp(join(site, "public"), join(site, "dist"), { recursive: true });
