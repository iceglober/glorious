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
        const payload = JSON.parse(body) as {
          files?: Array<{ file?: unknown; content?: unknown }>;
        };
        if (!Array.isArray(payload.files) || payload.files.length === 0)
          throw new Error("files are required");
        const files = payload.files.map((entry) => {
          if (typeof entry.file !== "string" || typeof entry.content !== "string")
            throw new Error("each file needs a path and content");
          const target = resolve(root, entry.file);
          const allowed =
            target === siteContent || target === changelog || target.startsWith(`${published}${sep}`);
          if (!allowed) throw new Error("file is outside editable content");
          return { ...entry, target } as { file: string; content: string; target: string };
        });
        await Promise.all(files.map((entry) => writeFile(entry.target, entry.content, "utf8")));
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ saved: files.map((entry) => entry.file) }));
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
