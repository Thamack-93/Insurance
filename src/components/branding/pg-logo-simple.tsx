"use client";

import { cn } from "@/lib/utils";

interface PGLogoSimpleProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function PGLogoSimple({ size = "md", className }: PGLogoSimpleProps) {
  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-lg", 
    xl: "text-2xl"
  };

  return (
    <div className={cn("font-bold tracking-tight text-stone-900", textSizes[size], className)}>
      <span>PG</span>
    </div>
  );
}
