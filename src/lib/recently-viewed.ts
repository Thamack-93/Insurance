export type RecentItem = {
  id: string;
  label: string;
  href: string;
  type: string;
  visitedAt: number;
};

const STORAGE_KEY = "pg_recently_viewed";
const MAX_ITEMS = 8;
export const RECENTLY_VIEWED_EVENT = "pg:recently-viewed-updated";

export function getRecentItems(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

export function recordRecentItem(item: Omit<RecentItem, "visitedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentItems().filter((i) => i.id !== item.id);
    const updated: RecentItem[] = [
      { ...item, visitedAt: Date.now() },
      ...existing,
    ].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(RECENTLY_VIEWED_EVENT));
  } catch {}
}
