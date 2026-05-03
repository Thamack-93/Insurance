import { getDb } from "@/lib/db";

export async function AuditByline({
  createdById,
  updatedById,
}: {
  createdById?: string | null;
  updatedById?: string | null;
}) {
  if (!createdById && !updatedById) return null;

  const ids = Array.from(new Set([createdById, updatedById].filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return null;

  const db = getDb();
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const createdBy = createdById ? byId.get(createdById) : null;
  const updatedBy = updatedById ? byId.get(updatedById) : null;

  const createdLabel = createdBy?.name ?? (createdById ? "Usuario eliminado" : null);
  const updatedLabel = updatedBy?.name ?? (updatedById ? "Usuario eliminado" : null);

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {createdLabel ? <>Creado por <span className="font-medium text-foreground/80">{createdLabel}</span></> : null}
      {createdLabel && updatedLabel ? " · " : null}
      {updatedLabel ? <>Última edición por <span className="font-medium text-foreground/80">{updatedLabel}</span></> : null}
    </p>
  );
}
