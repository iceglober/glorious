import { writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = resolve(__dirname, "..");
const published = resolve(root, "docs", "published");
const siteContent = resolve(__dirname, "src", "content", "site.json");
const changelog = resolve(root, "CHANGELOG.md");
const editMode = process.env.GLORIOUS_EDIT === "1";

const localEditor = (): Plugin => ({
  name: "glorious-local-editor",
  configureServer(server) {
    if (!editMode) return;
    server.middlewares.use("/__glorious_edit", async (request, response) => {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end("POST only");
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      try {
        const payload = JSON.parse(body) as { file?: unknown; content?: unknown };
        if (typeof payload.file !== "string" || typeof payload.content !== "string")
          throw new Error("file and content are required");
        const target = resolve(root, payload.file);
        const allowed =
          target === siteContent || target === changelog || target.startsWith(`${published}${sep}`);
        if (!allowed) throw new Error("file is outside editable content");
        await writeFile(target, payload.content, "utf8");
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ saved: payload.file }));
      } catch (error) {
        response.statusCode = 400;
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), localEditor()],
  define: { __GLORIOUS_EDIT__: JSON.stringify(editMode) },
  resolve: { alias: { "~": resolve(__dirname, "src") } },
  server: {
    fs: { allow: [root, resolve(__dirname)] },
    historyApiFallback: true,
  },
  preview: { headers: { "Cache-Control": "no-store" } },
  appType: "spa",
});
