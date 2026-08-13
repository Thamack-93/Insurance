"use client";

import { Fragment, useMemo } from "react";
import { normalize } from "@/lib/search-utils";

type HighlightProps = {
  text: string;
  query: string;
  className?: string;
};

export function Highlight({ text, query, className }: HighlightProps) {
  const parts = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return [{ value: text, match: false }];
    const norm = normalize(text);
    const out: Array<{ value: string; match: boolean }> = [];
    let cursor = 0;
    let pos = norm.indexOf(needle, cursor);
    while (pos !== -1) {
      if (pos > cursor) out.push({ value: text.slice(cursor, pos), match: false });
      out.push({ value: text.slice(pos, pos + needle.length), match: true });
      cursor = pos + needle.length;
      pos = norm.indexOf(needle, cursor);
    }
    if (cursor < text.length) out.push({ value: text.slice(cursor), match: false });
    return out;
  }, [text, query]);

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.match ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/30"
          >
            {p.value}
          </mark>
        ) : (
          <Fragment key={i}>{p.value}</Fragment>
        ),
      )}
    </span>
  );
}
