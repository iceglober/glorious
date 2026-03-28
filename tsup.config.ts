import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __createRequire } from "module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  noExternal: [/.*/],
  splitting: false,
  treeshake: true,
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      "react-devtools-core": resolve(__dirname, "src/shims/empty.js"),
    };
  },
  define: {
    __WTM_VERSION__: JSON.stringify(pkg.version),
  },
});
