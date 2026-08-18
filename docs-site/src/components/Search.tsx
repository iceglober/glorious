import { useState } from "react";
import { Link } from "react-router";
import { useEditMode } from "./EditMode";
import { SECTIONS } from "~/navigation";

const PAGES: Array<{ key: string; to: string }> = [
  ...SECTIONS.flatMap((section) => [...section.pages]),
  { key: "features", to: "/features" },
];

export function Search() {
  const [query, setQuery] = useState("");
  const { text } = useEditMode();
  const results =
    query.trim() === ""
      ? []
      : PAGES.filter((page) => text(`pages.${page.key}`).toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="site-search">
      <input
        aria-label="Search documentation"
        placeholder={text("search.placeholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length > 0 && (
        <div className="search-results">
          {results.map((page) => (
            <Link key={page.to} to={page.to} onClick={() => setQuery("")}>
              {text(`pages.${page.key}`)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
