"use client";

import { RouteError } from "@/components/loading/route-error";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      {...props}
      title="No pudimos cargar los documentos"
      description="Reintenta o vuelve al panel principal."
    />
  );
}
