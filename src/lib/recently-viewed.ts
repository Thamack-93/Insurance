export type RecentItem = {
  id: string;
  label: string;
  href: string;
  type: string;
  visitedAt: number;
};

const STORAGE_KEY_PREFIX = "pg_recently_viewed";
const MAX_ITEMS = 8;
export const RECENTLY_VIEWED_EVENT = "pg:recently-viewed-updated";
export const EMPTY_RECENT_ITEMS: RecentItem[] = [];

let cachedStorageKey: string | null = null;
let cachedRaw: string | null = null;
let cachedItems: RecentItem[] = EMPTY_RECENT_ITEMS;

function getStorageKey(userId: string, organizationId: string): string | null {
  if (!userId || !organizationId) return null;
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}`;
}

export function getRecentItems(userId: string, organizationId: string): RecentItem[] {
  const storageKey = getStorageKey(userId, organizationId);
  if (typeof window === "undefined" || !storageKey) return EMPTY_RECENT_ITEMS;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      cachedStorageKey = storageKey;
      cachedRaw = null;
      cachedItems = EMPTY_RECENT_ITEMS;
      return cachedItems;
    }
    if (storageKey === cachedStorageKey && raw === cachedRaw) return cachedItems;

    const parsed = JSON.parse(raw);
    cachedStorageKey = storageKey;
    cachedRaw = raw;
    cachedItems = Array.isArray(parsed) ? (parsed as RecentItem[]) : EMPTY_RECENT_ITEMS;
    return cachedItems;
  } catch {
    cachedStorageKey = null;
    cachedRaw = null;
    cachedItems = EMPTY_RECENT_ITEMS;
    return cachedItems;
  }
}

export function recordRecentItem(
  item: Omit<RecentItem, "visitedAt">,
  userId: string,
  organizationId: string,
): void {
  const storageKey = getStorageKey(userId, organizationId);
  if (typeof window === "undefined" || !storageKey) return;
  try {
    const existing = getRecentItems(userId, organizationId).filter((i) => i.id !== item.id);
    const updated: RecentItem[] = [
      { ...item, visitedAt: Date.now() },
      ...existing,
    ].slice(0, MAX_ITEMS);
    const raw = JSON.stringify(updated);
    window.localStorage.setItem(storageKey, raw);
    cachedStorageKey = storageKey;
    cachedRaw = raw;
    cachedItems = updated;
    window.dispatchEvent(new CustomEvent(RECENTLY_VIEWED_EVENT));
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[recently-viewed] failed to persist item", error);
    }
  }
}
