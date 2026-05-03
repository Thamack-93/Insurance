"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/settings";
import { setRuntimeSettings } from "@/lib/settings-runtime";

/**
 * Hydrates the client-side runtime settings cache so that `formatCurrency`
 * and `formatDate` (which live in shared modules used by both server and
 * client components) read the user's persisted preferences instead of the
 * baked-in fallback values.
 *
 * Updates the cache both before first paint (via the useState initializer)
 * and whenever the layout re-renders with new settings, so an in-session
 * change to currency/dateFormat is reflected without a hard reload.
 */
export function RuntimeSettingsHydrator({ settings }: { settings: Settings }) {
  // Runs once during render, before children commit, so any client child
  // that calls formatCurrency/formatDate immediately picks up the right
  // defaults on the very first render.
  useState(() => {
    setRuntimeSettings(settings);
    return null;
  });

  // Re-hydrate when settings change (e.g., after updateSettings revalidates
  // the layout and the dashboard layout passes down fresh values).
  useEffect(() => {
    setRuntimeSettings(settings);
  }, [
    settings.defaultCurrency,
    settings.dateFormat,
    settings.theme,
    settings.autoBackup,
    settings.backupFrequency,
    settings.retentionDays,
  ]);

  return null;
}
