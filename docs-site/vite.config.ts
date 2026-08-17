import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "~": resolve(__dirname, "src") },
  },
  server: {
    // The published Markdown is shared with the repository docs.
    fs: { allow: [resolve(__dirname, ".."), resolve(__dirname)] },
    // SPA fallback — serve index.html for all routes
    historyApiFallback: true,
  },
  // Also needed for `vite preview`
  preview: {
    headers: { "Cache-Control": "no-store" },
  },
  appType: "spa",
});
