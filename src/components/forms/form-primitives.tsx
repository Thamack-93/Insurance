"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("grid gap-4 md:grid-cols-2", className)}>{children}</div>;
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-3xl border bg-white/70 p-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function FormErrorBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

export function FormActions({
  cancelHref,
  submitLabel,
  pending,
}: {
  cancelHref: string;
  submitLabel: string;
  pending?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200/80 pt-5">
      <Button asChild type="button" variant="outline" className="rounded-full bg-white/80">
        <Link href={cancelHref}>Cancelar</Link>
      </Button>
      <Button type="submit" className="rounded-full" disabled={pending}>
        {pending ? "Guardando..." : submitLabel}
      </Button>
    </div>
  );
}