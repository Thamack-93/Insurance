"use client";

import Link from "next/link";
import { Children, cloneElement, isValidElement, useId, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/lib/domain-options";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const describedBy = errorId ?? hintId;

  // Clone the first valid child element to inject id + aria-* on the actual control.
  const enhancedChildren = Children.map(children, (child, index) => {
    if (!isValidElement(child) || index !== 0) return child;
    const childProps = (child.props ?? {}) as Record<string, unknown>;
    return cloneElement(child as React.ReactElement<Record<string, unknown>>, {
      id: childProps.id ?? fieldId,
      "aria-invalid": error ? true : (childProps["aria-invalid"] as boolean | undefined),
      "aria-describedby": describedBy ?? (childProps["aria-describedby"] as string | undefined),
      "aria-required": required || (childProps["aria-required"] as boolean | undefined),
    });
  });

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {enhancedChildren}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!error && hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
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
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}

export function ControlledSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? "";
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next ?? "")}>
      <SelectTrigger className={cn("h-10 w-full rounded-xl bg-white", className)}>
        <SelectValue placeholder={placeholder ?? "Selecciona una opción"}>
          {label || undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
