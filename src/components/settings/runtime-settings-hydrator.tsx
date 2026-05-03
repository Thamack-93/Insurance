"use client";

import { useState } from "react";
import type { Settings } from "@/lib/settings";
import { setRuntimeSettings } from "@/lib/settings-runtime";

/**
 * Hydrates the client-side runtime settings cache so that `formatCurrency`
 * and `formatDate` (which live in shared modules used by both server and
 * client components) read the user's persisted preferences instead of the
 * baked-in fallback values.
 */
export function RuntimeSettingsHydrator({ settings }: { settings: Settings }) {
  // useState initializer runs once during render, before children commit, so
  // any client child that calls formatCurrency/formatDate immediately picks up
  // the right defaults.
  useState(() => {
    setRuntimeSettings(settings);
    return null;
  });
  return null;
}
