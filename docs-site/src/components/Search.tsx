import { useState } from "react";
import { Link } from "react-router";

const PAGES = [
  ["install", "/install"], ["quickstart", "/quickstart"], ["features", "/features"], ["philosophy", "/philosophy"],
  ["glossary", "/glossary"], ["extensions", "/extensions"], ["commands", "/commands"], ["skills", "/skills"],
  ["tools", "/tools"], ["providers", "/providers"], ["models", "/models"],
  ["configuration", "/configuration"], ["architecture", "/architecture"], ["troubleshooting", "/troubleshooting"],
  ["extension API", "/api"], ["changelog", "/changelog"],
] as const;

export function Search() {
  const [query, setQuery] = useState("");
  const results = query.trim() === "" ? [] : PAGES.filter(([label]) => label.includes(query.toLowerCase()));
  return (
    <div className="site-search">
      <input aria-label="Search documentation" placeholder="search docs" value={query} onChange={(event) => setQuery(event.target.value)} />
      {results.length > 0 && <div className="search-results">{results.map(([label, to]) => <Link key={to} to={to} onClick={() => setQuery("")}>{label}</Link>)}</div>}
    </div>
  );
}
