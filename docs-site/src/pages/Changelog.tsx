import { useEffect, useState } from "react";
import { useEditMode } from "~/components/EditMode";
import { Doc } from "./Doc";

function cleanChangelog(raw: string): string {
  return raw
    .replace(/^#\s+@glrs-dev\/.*\n+/, "")
    .replace(/^(## \d+\.\d+\.\d+)\n+(## )/gm, "$2");
}

export function Changelog() {
  const { editing } = useEditMode();
  const [changelog, setChangelog] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      void import("../../../CHANGELOG.md?raw").then(({ default: local }) => setChangelog(local));
      return;
    }
    fetch("https://raw.githubusercontent.com/iceglober/glorious/main/CHANGELOG.md")
      .then((response) => response.text())
      .then((text) => setChangelog(`# Changelog\n\n${cleanChangelog(text).trim() || "No releases yet."}`))
      .catch(() => setChangelog("# Changelog\n\nFailed to load changelog."));
  }, [editing]);

  return changelog ? (
    <Doc md={changelog} title="Changelog" source={editing ? "CHANGELOG.md" : undefined} />
  ) : (
    <main className="site-main doc">
      <h1>Changelog</h1>
      <p>Loading…</p>
    </main>
  );
}
