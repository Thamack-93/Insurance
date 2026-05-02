"use client";

import { useEffect } from "react";
import { recordRecentItem } from "@/lib/recently-viewed";

interface RecordPageViewProps {
  id: string;
  label: string;
  href: string;
  type: string;
}

export function RecordPageView({ id, label, href, type }: RecordPageViewProps) {
  useEffect(() => {
    recordRecentItem({ id, label, href, type });
  }, [id, label, href, type]);
  return null;
}
