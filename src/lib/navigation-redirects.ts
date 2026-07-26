type SearchParams = Record<string, string | string[] | undefined>;

export function buildCanonicalHref(
  pathname: string,
  searchParams: SearchParams = {},
  forcedParams: Record<string, string> = {},
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key in forcedParams || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else params.set(key, value);
  }

  for (const [key, value] of Object.entries(forcedParams)) params.set(key, value);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
