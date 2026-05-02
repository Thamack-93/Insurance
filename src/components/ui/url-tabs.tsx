"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

export function UrlTabs({
  paramKey = "tab",
  defaultValue,
  className,
  children,
}: {
  paramKey?: string;
  defaultValue: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(paramKey) ?? defaultValue;

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (!next) return;
        const sp = new URLSearchParams(params.toString());
        sp.set(paramKey, next);
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
      }}
      className={className}
    >
      {children}
    </Tabs>
  );
}
