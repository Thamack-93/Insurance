"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, Circle, FolderKanban, ReceiptText, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/pages-secondary/panels";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingStatus } from "@/lib/dashboard-queries";
import { dismissOnboarding } from "@/app/(dashboard)/dashboard/actions";

type Step = {
  key: keyof Pick<OnboardingStatus, "insurers" | "clients" | "policies" | "receipts">;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const STEPS: Step[] = [
  {
    key: "insurers",
    title: "Crear tu primera aseguradora",
    description: "Registra al menos una compañía para asignar pólizas.",
    href: "/insurers/new",
    icon: Building2,
  },
  {
    key: "clients",
    title: "Crear tu primer cliente",
    description: "Captura contacto, RFC y notas de tu primer asegurado.",
    href: "/clients/new",
    icon: Users,
  },
  {
    key: "policies",
    title: "Crear tu primera póliza",
    description: "Vincula cliente y aseguradora con vigencia y prima.",
    href: "/policies/new",
    icon: FolderKanban,
  },
  {
    key: "receipts",
    title: "Registrar tu primer recibo",
    description: "Empieza el control de pagos con un recibo programado.",
    href: "/receipts/new",
    icon: ReceiptText,
  },
];

export function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const completedCount = STEPS.filter((s) => status[s.key] > 0).length;

  const onDismiss = () => {
    startTransition(async () => {
      const result = await dismissOnboarding();
      if (result.ok) {
        toast.success(result.message || "Listo, ocultamos la guía.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <SectionCard
      title="Empieza aquí"
      description={`Da los primeros pasos para tener tu cartera operando (${completedCount}/${STEPS.length}).`}
      action={
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={pending} className="text-muted-foreground">
          {pending ? "Ocultando..." : "Ocultar guía"}
        </Button>
      }
    >
      <ul className="divide-y divide-border/70">
        {STEPS.map((step) => {
          const done = status[step.key] > 0;
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex items-center gap-4 px-5 py-4">
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full border",
                  done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : "border-border bg-muted/40 text-muted-foreground",
                )}
                aria-hidden
              >
                {done ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Icon className={cn("size-4 shrink-0", done ? "text-muted-foreground" : "text-foreground/70")} />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      done ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{step.description}</p>
                </div>
              </div>
              {done ? (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300">Completado</span>
              ) : (
                <Link
                  href={step.href}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Empezar
                  <ArrowRight className="ml-1 size-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
