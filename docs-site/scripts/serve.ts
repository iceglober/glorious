import { join, normalize } from "node:path";
import type { ServerWebSocket } from "bun";

const root = join(import.meta.dir, "..", "dist");
const clients = new Set<ServerWebSocket<unknown>>();
const types: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
};
const reloadScript = `<script>(()=>{const protocol=location.protocol==='https:'?'wss':'ws';const socket=new WebSocket(protocol+'://'+location.host+'/__reload');socket.onmessage=()=>location.reload()})()</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4180,
  websocket: {
    open(socket) {
      clients.add(socket);
    },
    close(socket) {
      clients.delete(socket);
    },
    message() {},
  },
  async fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === "/__reload")
      return bunServer.upgrade(request) ? undefined : new Response("Upgrade required", { status: 426 });
    if (url.pathname === "/__notify_reload" && request.method === "POST") {
      for (const client of clients) client.send("reload");
      return new Response("ok");
    }

    const requested = normalize(url.pathname).replace(/^\/+/, "");
    const direct = join(root, requested === "" ? "index.html" : requested);
    const nested = join(direct, "index.html");
    let path = requested === "" || !url.pathname.endsWith("/") ? direct : nested;
    let file = Bun.file(path);
    if (!(await file.exists()) && !url.pathname.includes(".")) {
      path = nested;
      file = Bun.file(path);
    }
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const extension = path.slice(path.lastIndexOf("."));
    if (extension === ".html") {
      const html = (await file.text()).replace("</body>", `${reloadScript}</body>`);
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }
    return new Response(file, { headers: { "Content-Type": types[extension] ?? file.type } });
  },
});

console.log(`TypeDoc site: http://127.0.0.1:${server.port}/`);
