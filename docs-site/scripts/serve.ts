import { join, normalize } from "node:path";

const root = join(import.meta.dir, "..", "dist");
const types: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4180,
  async fetch(request) {
    const url = new URL(request.url);
    const requested = normalize(url.pathname).replace(/^\/+/, "");
    const path = join(root, requested === "" ? "index.html" : requested);
    const file = Bun.file(path);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const extension = path.slice(path.lastIndexOf("."));
    return new Response(file, { headers: { "Content-Type": types[extension] ?? file.type } });
  },
});

console.log(`TypeDoc site: http://127.0.0.1:${server.port}/`);
