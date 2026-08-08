"use client";

import { useSyncExternalStore, useTransition } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { updateUserTheme } from "@/lib/settings";

export type ThemeMode = "light" | "dark";

const subscribeToNothing = () => () => {};

export function ThemeToggle({ initialTheme }: { initialTheme: ThemeMode }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  // `false` on the server and during hydration, `true` on every render after.
  // The first client render therefore matches the server byte for byte, while
  // next-themes (which reads localStorage) only takes over once hydration is
  // done. Without this the label would differ between server and client.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const currentTheme: ThemeMode = hydrated
    ? resolvedTheme === "dark"
      ? "dark"
      : "light"
    : initialTheme;
  const nextTheme: ThemeMode = currentTheme === "dark" ? "light" : "dark";
  const label = nextTheme === "dark" ? "Cambiar a modo oscuro" : "Cambiar a modo claro";

  const handleToggle = () => {
    setTheme(nextTheme);
    startTransition(async () => {
      try {
        await updateUserTheme(nextTheme);
      } catch {
        // Persisting is best-effort from the toggle; the visible theme already updated.
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className="relative bg-card/75"
      onClick={handleToggle}
      disabled={isPending}
      aria-label={label}
      title={label}
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
