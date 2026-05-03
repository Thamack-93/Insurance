"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { setOnboardingDismissed } from "@/app/(dashboard)/dashboard/actions";

export function OnboardingPanel({ initialDismissed }: { initialDismissed: boolean }) {
  // Toggle semantics: ON = la guía se muestra (dismissed=false).
  const [show, setShow] = useState(!initialDismissed);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleChange = (next: boolean) => {
    const previous = show;
    setShow(next);
    startTransition(async () => {
      const result = await setOnboardingDismissed(!next);
      if (result.ok) {
        toast.success(
          next ? "La guía volverá a mostrarse en el dashboard." : "Guía oculta del dashboard.",
        );
        router.refresh();
      } else {
        setShow(previous);
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guía de inicio</CardTitle>
        <CardDescription>
          Controla la checklist “Empieza aquí” que aparece en el dashboard cuando aún faltan registros base.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="show-onboarding">Mostrar guía de inicio en el dashboard</Label>
            <p className="text-sm text-muted-foreground">
              Si la activas, la guía vuelve a verse en cuanto haya algún paso pendiente. Cuando ya
              tengas aseguradora, cliente, póliza y recibo, se oculta sola.
            </p>
          </div>
          <Checkbox
            id="show-onboarding"
            checked={show}
            disabled={pending}
            onCheckedChange={(checked) => handleChange(checked === true)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
