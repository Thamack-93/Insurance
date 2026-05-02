import { getDb } from "@/lib/db";

export async function globalSearch(query: string) {
  const db = getDb();
  const q = query.trim();

  if (!q) return [];

  const [clients, policies, insurers, receipts, tasks, documents, commissions] =
    await Promise.all([
      db.client.findMany({
        where: { fullName: { contains: q } },
        take: 5,
      }),
      db.policy.findMany({
        where: { policyNumber: { contains: q } },
        take: 5,
      }),
      db.insurer.findMany({
        where: { name: { contains: q } },
        take: 5,
      }),
      db.receipt.findMany({
        where: { receiptNumber: { contains: q } },
        take: 5,
      }),
      db.task.findMany({
        where: {
          OR: [{ folio: { contains: q } }, { title: { contains: q } }],
        },
        take: 5,
      }),
      db.document.findMany({
        where: { fileName: { contains: q } },
        take: 5,
      }),
      db.commission.findMany({
        where: { notes: { contains: q } },
        take: 5,
      }),
    ]);

  return [
    ...clients.map((item) => ({ type: "Cliente", label: item.fullName, href: `/clients/${item.id}` })),
    ...policies.map((item) => ({ type: "Poliza", label: item.policyNumber, href: `/policies/${item.id}` })),
    ...insurers.map((item) => ({ type: "Aseguradora", label: item.name, href: `/settings` })),
    ...receipts.map((item) => ({ type: "Recibo", label: item.receiptNumber, href: `/receipts` })),
    ...tasks.map((item) => ({ type: "Pendiente", label: `${item.folio} · ${item.title}`, href: `/tasks` })),
    ...documents.map((item) => ({ type: "Documento", label: item.fileName, href: `/documents` })),
    ...commissions.map((item) => ({ type: "Comision", label: item.notes ?? item.id, href: `/commissions` })),
  ];
}

