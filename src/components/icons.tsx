"use client";

/**
 * Re-export lucide-react icons as Client Components so Server Components can
 * import them without triggering Turbopack's SSR createContext restriction.
 */
export {
  ShieldCheck,
  // Add more icons here as needed
} from "lucide-react";
