"use client";

import { Button } from "@/components/ui/button";

export function KnowledgeSourceActivationButton({
  action,
  title,
  version,
  chunkCount,
  effectiveFrom,
  effectiveTo,
}: {
  action: () => Promise<void>;
  title: string;
  version: string;
  chunkCount: number;
  effectiveFrom: string;
  effectiveTo: string;
}) {
  return (
    <form action={action} onSubmit={(event) => {
      const dates = effectiveFrom || effectiveTo ? ` Vigencia: ${effectiveFrom || "sin inicio"} a ${effectiveTo || "sin fin"}.` : "";
      if (!window.confirm(`Activar “${title}” v${version} con ${chunkCount} fragmentos.${dates} La versión activa anterior del mismo producto se archivará.`)) event.preventDefault();
    }}>
      <Button type="submit" size="sm" className="rounded-full">Activar</Button>
    </form>
  );
}

