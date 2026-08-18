import { useEffect, useState, type ComponentType } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

type Components = Record<string, ComponentType<any>>;

export function MdxPreview({ source, components }: { source: string; components: Components }) {
  const [Content, setContent] = useState<ComponentType<{ components?: Components }> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void import("@mdx-js/mdx")
      .then(({ evaluate }) =>
        evaluate(source, {
          Fragment,
          jsx,
          jsxs,
          baseUrl: import.meta.url,
        }),
      )
      .then((module) => {
        if (!active) return;
        setContent(() => module.default as ComponentType<{ components?: Components }>);
        setError("");
      })
      .catch((failure) => {
        if (!active) return;
        setContent(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
    };
  }, [source]);

  if (error) return <pre className="mdx-error">{error}</pre>;
  return Content ? <Content components={components} /> : <p>Rendering…</p>;
}
