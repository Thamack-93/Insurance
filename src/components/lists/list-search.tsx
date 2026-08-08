"use client";

import { useEffect, useRef, useState, useTransition, memo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ListSearchProps = {
  placeholder?: string;
  paramName?: string;
  className?: string;
};

export const ListSearch = memo(function ListSearch({
  placeholder = "Buscar...",
  paramName = "q",
  className,
}: ListSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get(paramName) ?? "";
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync external param changes (e.g., back/forward) into the input.
  useEffect(() => {
    setValue(searchParams.get(paramName) ?? "");
  }, [searchParams, paramName]);

  // Listen for global focus shortcut.
  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener("pg:focus-list-search", handler);
    return () => window.removeEventListener("pg:focus-list-search", handler);
  }, []);

  // Debounced URL update.
  useEffect(() => {
    if (value === initial) return;
    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed.length > 0) sp.set(paramName, trimmed);
      else sp.delete(paramName);
      sp.delete("page");
      const qs = sp.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [value, initial, searchParams, paramName, pathname, router]);

  return (
    <div className={cn("relative w-full md:max-w-xs", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        data-list-search
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-3" />
        </button>
      ) : null}
      {isPending ? (
        <span className="sr-only" aria-live="polite">
          Buscando...
        </span>
      ) : null}
    </div>
  );
});
