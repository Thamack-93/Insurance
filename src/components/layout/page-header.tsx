import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  metadata,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  metadata?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.24em] text-bronze">{eyebrow}</p> : null}
        <h1 className="font-display mt-1.5 text-[32px] font-medium tracking-tight text-foreground md:text-[36px]">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        {metadata ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{metadata}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-medium tracking-tight">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
