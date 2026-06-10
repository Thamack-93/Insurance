"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type PageRefreshTickerProps = {
  intervalMs?: number;
  enabled?: boolean;
};

export function PageRefreshTicker({ intervalMs = 60 * 60 * 1000, enabled = true }: PageRefreshTickerProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => router.refresh();
    const intervalId = window.setInterval(refresh, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, router]);

  return null;
}
