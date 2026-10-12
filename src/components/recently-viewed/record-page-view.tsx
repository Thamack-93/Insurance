"use client";

import { useEffect } from "react";
import { useNoraSession } from "@/components/assistant/nora-session-provider";
import { recordRecentItem } from "@/lib/recently-viewed";

interface RecordPageViewProps {
  id: string;
  label: string;
  href: string;
  type: string;
}

export function RecordPageView({ id, label, href, type }: RecordPageViewProps) {
  const { userId, organizationId } = useNoraSession();
  useEffect(() => {
    recordRecentItem({ id, label, href, type }, userId, organizationId);
  }, [href, id, label, organizationId, type, userId]);
  return null;
}
