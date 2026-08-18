export const SECTIONS = [
  { key: "get-started", to: "/get-started", pages: [{ key: "install", to: "/install" }, { key: "quickstart", to: "/quickstart" }] },
  { key: "concepts", to: "/concepts", pages: [{ key: "philosophy", to: "/philosophy" }, { key: "glossary", to: "/glossary" }, { key: "architecture", to: "/architecture" }] },
  { key: "extend", to: "/extend", pages: [{ key: "extensions", to: "/extensions" }, { key: "skills", to: "/skills" }, { key: "commands", to: "/commands" }] },
  { key: "reference", to: "/reference", pages: [{ key: "tools", to: "/tools" }, { key: "providers", to: "/providers" }, { key: "models", to: "/models" }, { key: "configuration", to: "/configuration" }, { key: "cli", to: "/cli" }, { key: "api", to: "/api" }] },
  { key: "help", to: "/help", pages: [{ key: "troubleshooting", to: "/troubleshooting" }, { key: "changelog", to: "/changelog" }] },
] as const;
