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
export const EMPTY_RECENT_ITEMS: RecentItem[] = [];

let cachedRaw: string | null = null;
let cachedItems: RecentItem[] = EMPTY_RECENT_ITEMS;

export function getRecentItems(): RecentItem[] {
  if (typeof window === "undefined") return EMPTY_RECENT_ITEMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedRaw = null;
      cachedItems = EMPTY_RECENT_ITEMS;
      return cachedItems;
    }
    if (raw === cachedRaw) return cachedItems;

    const parsed = JSON.parse(raw);
    cachedRaw = raw;
    cachedItems = Array.isArray(parsed) ? (parsed as RecentItem[]) : EMPTY_RECENT_ITEMS;
    return cachedItems;
  } catch {
    cachedRaw = null;
    cachedItems = EMPTY_RECENT_ITEMS;
    return cachedItems;
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
    const raw = JSON.stringify(updated);
    localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedItems = updated;
    window.dispatchEvent(new CustomEvent(RECENTLY_VIEWED_EVENT));
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[recently-viewed] failed to persist item", error);
    }
  }
}
