"use client";

import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Adaptive chart box.
 *
 * Charts used to be pinned to a fixed pixel height, which left them cramped on
 * tall desktop cards and oversized on phones. The frame instead grows with the
 * card (`flex-1`) and falls back to a viewport-relative height with a legible
 * floor and a ceiling that keeps a chart from swallowing the page.
 */
export function ChartFrame({
  children,
  className,
}: {
  children: ReactElement;
  className?: string;
}) {
  return (
    <div className={cn("relative h-[clamp(11rem,26vh,18rem)] w-full min-h-44 flex-1", className)}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }} debounce={1}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
