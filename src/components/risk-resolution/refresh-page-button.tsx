"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type RefreshPageButtonProps = {
  label?: string;
  className?: string;
};

export function RefreshPageButton({ label = "Actualizar", className }: RefreshPageButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={className ?? "rounded-full"}
      onClick={handleRefresh}
      disabled={isPending}
    >
      <RefreshCw className={isPending ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />
      {isPending ? "Actualizando..." : label}
    </Button>
  );
}
