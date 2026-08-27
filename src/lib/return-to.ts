const INTERNAL_ORIGIN = "http://policydesk.internal";
const RETURNABLE_ROOTS = ["/clients", "/policies", "/receipts", "/operations", "/quotes", "/portfolio", "/commissions"] as const;

function isReturnablePath(pathname: string) {
  return RETURNABLE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function normalizeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN || !isReturnablePath(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function appendReturnTo(href: string, returnTo: string | null | undefined) {
  const safeReturnTo = normalizeReturnTo(returnTo, "");
  if (!safeReturnTo) return href;
  const url = new URL(href, INTERNAL_ORIGIN);
  url.searchParams.set("returnTo", safeReturnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}
