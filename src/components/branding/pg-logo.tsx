"use client";

import { cn } from "@/lib/utils";

interface PGLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "default" | "minimal" | "monogram" | "badge";
  className?: string;
}

export function PGLogo({ size = "md", variant = "default", className }: PGLogoProps) {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8", 
    lg: "h-12 w-12",
    xl: "h-16 w-16"
  };

  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-lg", 
    xl: "text-2xl"
  };

  // Variant 1: Modern Interlocking Letters
  if (variant === "default") {
    return (
      <div className={cn("relative flex items-center justify-center", sizeClasses[size], className)}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          className="w-full h-full"
        >
          {/* P Letter */}
          <path
            d="M20 25 L20 75 L35 75 L35 55 L45 55 Q55 55 55 40 Q55 25 45 25 L20 25 Z M35 35 L40 35 Q45 35 45 40 Q45 45 40 45 L35 45 L35 35 Z"
            fill="currentColor"
            className="text-stone-900"
          />
          {/* G Letter */}
          <path
            d="M65 25 Q55 25 55 35 L55 65 Q55 75 65 75 Q75 75 75 65 L75 55 L70 55 L70 65 Q70 70 65 70 Q60 70 60 65 L60 35 Q60 30 65 30 Q70 30 70 35 L75 35 Q75 25 65 25 Z"
            fill="currentColor"
            className="text-stone-900"
          />
        </svg>
      </div>
    );
  }

  // Variant 2: Minimal Text
  if (variant === "minimal") {
    return (
      <div className={cn("font-bold tracking-tight", textSizes[size], className)}>
        <span className="text-stone-900">PG</span>
      </div>
    );
  }

  // Variant 3: Monogram Circle
  if (variant === "monogram") {
    return (
      <div className={cn("relative flex items-center justify-center", sizeClasses[size], className)}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          className="w-full h-full"
        >
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-900" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="32" fontWeight="bold" fill="currentColor" className="text-stone-900">
            PG
          </text>
        </svg>
      </div>
    );
  }

  // Variant 4: Badge Style
  if (variant === "badge") {
    return (
      <div className={cn("flex items-center justify-center rounded-full bg-stone-900 text-white font-bold", sizeClasses[size], className)}>
        <span className={textSizes[size]}>PG</span>
      </div>
    );
  }

  return null;
}
