import { useState } from "react";
import { Link } from "react-router";
import { useEditMode } from "./EditMode";

export function Search() {
  const [query, setQuery] = useState("");
  const { content, text } = useEditMode();
  const pages = content.navigation.flatMap((section) => section.pages);
  const results =
    query.trim() === ""
      ? []
      : pages.filter((page) => page.label.toLowerCase().includes(query.toLowerCase()));
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
            <Link key={page.slug} to={`/${page.slug}`} onClick={() => setQuery("")}>
              {page.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
