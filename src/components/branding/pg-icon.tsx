"use client";

import { cn } from "@/lib/utils";

interface PGIconProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function PGIcon({ size = "md", className }: PGIconProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
    xl: "w-8 h-8"
  };

  return (
    <div className={cn("flex items-center justify-center font-bold text-stone-900", sizeClasses[size], className)}>
      <span className="text-xs md:text-sm">PG</span>
    </div>
  );
}
