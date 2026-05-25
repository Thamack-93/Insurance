"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const NEW_HREF_BY_PREFIX: Array<{ prefix: string; href: string }> = [
  { prefix: "/clients", href: "/clients/new" },
  { prefix: "/policies", href: "/policies/new" },
  { prefix: "/tasks", href: "/tasks/new" },
  { prefix: "/receipts", href: "/receipts/new" },
  { prefix: "/insurers", href: "/insurers/new" },
  { prefix: "/claims", href: "/claims/new" },
  { prefix: "/quotes", href: "/quotes/new" },
];

const DETAIL_LIST_PREFIXES = [
  "/clients",
  "/policies",
  "/tasks",
  "/receipts",
  "/insurers",
  "/claims",
  "/quotes",
];

function detailListingFor(pathname: string): string | null {
  for (const prefix of DETAIL_LIST_PREFIXES) {
    if (!pathname.startsWith(`${prefix}/`)) continue;
    const rest = pathname.slice(prefix.length + 1);
    // Only match a single id segment: skip /new, sub-routes (/edit, /pagos, ...) and empty.
    if (rest === "" || rest === "new" || rest.includes("/")) return null;
    return prefix;
  }
  return null;
}

const NAV_KEYS: Record<string, string> = {
  d: "/dashboard",
  h: "/today",
  c: "/clients",
  p: "/policies",
  r: "/receipts",
  t: "/tasks",
  s: "/insurers",
  q: "/quotes",
  x: "/claims",
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.getAttribute("role") === "textbox") return true;
  return false;
}

export function useGlobalShortcuts(onShowHelp: () => void) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let leaderTimer: number | null = null;
    let leaderActive = false;

    const clearLeader = () => {
      if (leaderTimer !== null) {
        window.clearTimeout(leaderTimer);
        leaderTimer = null;
      }
      leaderActive = false;
    };

    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key;

      if (leaderActive) {
        const lower = key.toLowerCase();
        const target = NAV_KEYS[lower];
        clearLeader();
        if (target) {
          event.preventDefault();
          router.push(target);
        }
        return;
      }

      if (key === "?") {
        event.preventDefault();
        onShowHelp();
        return;
      }

      if (key === "/") {
        event.preventDefault();
        const detail = window.dispatchEvent(new CustomEvent("pg:focus-list-search"));
        if (!detail) {
          // Fallback: focus first searchable input.
          const input = document.querySelector<HTMLInputElement>("input[data-list-search]");
          input?.focus();
        }
        return;
      }

      if (key === "n" || key === "N") {
        const match = NEW_HREF_BY_PREFIX.find((entry) =>
          pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
        );
        if (match) {
          event.preventDefault();
          router.push(match.href);
        }
        return;
      }

      if (key === "g" || key === "G") {
        event.preventDefault();
        leaderActive = true;
        leaderTimer = window.setTimeout(() => {
          leaderActive = false;
        }, 1200);
        return;
      }

      if (key === "Escape") {
        // Don't fight any open dialogs/popups: only act when nothing else
        // is open (no [data-state=open] in the document) and we're on a
        // detail page like /clients/abc or /policies/abc.
        const hasOpenOverlay = document.querySelector('[data-state="open"]');
        if (hasOpenOverlay) return;
        const listing = detailListingFor(pathname);
        if (listing) {
          event.preventDefault();
          router.push(listing);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (leaderTimer !== null) {
        window.clearTimeout(leaderTimer);
      }
    };
  }, [router, pathname, onShowHelp]);
}
