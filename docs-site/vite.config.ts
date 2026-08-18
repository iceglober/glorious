import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = resolve(__dirname, "..");
const published = resolve(root, "docs", "published");
const siteContent = resolve(__dirname, "src", "content", "site.json");
const changelog = resolve(root, "CHANGELOG.md");
const editMode = process.env.GLORIOUS_EDIT === "1";
const generated = resolve(__dirname, "src", "generated");
const publicAssets = resolve(__dirname, "public");
const uploadedAssets = resolve(publicAssets, "assets");

const filesUnder = async (directory: string): Promise<string[]> => {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
};

const editable = (target: string): boolean =>
  target === siteContent || target === changelog || target.startsWith(`${published}${sep}`);

const bodyOf = async (request: import("node:http").IncomingMessage): Promise<string> => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 15_000_000) throw new Error("request is too large");
  }
  return body;
};

const localEditor = (): Plugin => ({
  name: "glorious-local-editor",
  configureServer(server) {
    if (!editMode) return;
    server.middlewares.use("/__glorious_templates", async (_request, response) => {
      const generatedTemplates = (await filesUnder(generated))
        .filter((file) => extname(file) === ".md")
        .map((file) => {
          const name = basename(file, ".md");
          return {
            value: `{{generated:${name}}}`,
            label: `generated:${name}`,
            description: relative(root, file),
            kind: "generated",
          };
        });
      const assets = await Promise.all(
        (await filesUnder(publicAssets)).map(async (file) => {
          const path = `/${relative(publicAssets, file).split(sep).join("/")}`;
          return {
            value: `{{asset:${path}}}`,
            label: `asset:${path}`,
            description: `${relative(root, file)} · ${(await stat(file)).size.toLocaleString()} bytes`,
            kind: "asset",
          };
        }),
      );
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify([...generatedTemplates, ...assets]));
    });
    server.middlewares.use("/__glorious_assets", async (request, response) => {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end("POST only");
        return;
      }
      try {
        const payload = JSON.parse(await bodyOf(request)) as { name?: unknown; data?: unknown };
        if (typeof payload.name !== "string" || typeof payload.data !== "string")
          throw new Error("name and data are required");
        const name = basename(payload.name).replace(/[^a-zA-Z0-9._-]/gu, "-");
        if (name === "" || name.startsWith(".")) throw new Error("invalid asset name");
        const match = /^data:[^;]+;base64,(.+)$/u.exec(payload.data);
        if (!match) throw new Error("asset must be base64 data");
        const bytes = Buffer.from(match[1], "base64");
        if (bytes.length > 10_000_000) throw new Error("asset exceeds 10 MB");
        await mkdir(uploadedAssets, { recursive: true });
        await writeFile(resolve(uploadedAssets, name), bytes);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ directive: `{{asset:/assets/${name}}}` }));
      } catch (error) {
        response.statusCode = 400;
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    server.middlewares.use("/__glorious_edit", async (request, response) => {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end("POST only");
        return;
      }
      try {
        const payload = JSON.parse(await bodyOf(request)) as {
          files?: Array<{ file?: unknown; content?: unknown; expected?: unknown }>;
          remove?: unknown;
        };
        if (!Array.isArray(payload.files)) throw new Error("files are required");
        const files = payload.files.map((entry) => {
          if (typeof entry.file !== "string" || typeof entry.content !== "string")
            throw new Error("each file needs a path and content");
          if (entry.expected !== undefined && typeof entry.expected !== "string")
            throw new Error("expected content must be text");
          const target = resolve(root, entry.file);
          if (!editable(target)) throw new Error("file is outside editable content");
          return {
            file: entry.file,
            content: entry.content,
            expected: entry.expected as string | undefined,
            target,
          };
        });
        const remove = Array.isArray(payload.remove)
          ? payload.remove.map((file) => {
              if (typeof file !== "string") throw new Error("remove paths must be text");
              const target = resolve(root, file);
              if (!target.startsWith(`${published}${sep}`))
                throw new Error("only published pages can be removed");
              return { file, target };
            })
          : [];
        for (const entry of files)
          if (entry.expected !== undefined) {
            const current = await readFile(entry.target, "utf8").catch(() => "");
            if (current !== entry.expected) {
              response.statusCode = 409;
              response.end(`${entry.file} changed on disk; reload before saving`);
              return;
            }
          }
        await Promise.all([
          ...files.map((entry) => writeFile(entry.target, entry.content, "utf8")),
          ...remove.map((entry) => rm(entry.target, { force: true })),
        ]);
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            saved: files.map((entry) => entry.file),
            removed: remove.map((entry) => entry.file),
          }),
        );
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
