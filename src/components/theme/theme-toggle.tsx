"use client";

import { useTransition } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { updateUserTheme } from "@/lib/settings";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    startTransition(async () => {
      try {
        await updateUserTheme(next);
      } catch {
        // Persisting is best-effort from the toggle; the visible theme already updated.
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className="relative rounded-full bg-card/75"
      onClick={handleToggle}
      disabled={isPending}
      aria-label="Cambiar tema"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
