import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..", "docs", "published");
const target = join(import.meta.dir, "..", "docs");
await rm(target, { recursive: true, force: true });
await cp(root, target, { recursive: true });
