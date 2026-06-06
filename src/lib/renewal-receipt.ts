import type { Prisma } from "@/generated/prisma/client";

export const LATEST_RENEWAL_RECEIPT_INCLUDE = {
  receipts: {
    orderBy: [
      { periodEndDate: "desc" as const },
      { dueDate: "desc" as const },
      { createdAt: "desc" as const },
    ],
    take: 1,
    select: {
      status: true,
      dueDate: true,
    },
  },
} satisfies Pick<Prisma.PolicyInclude, "receipts">;

export function getLatestReceiptStatus(receipts: Array<{ status: string | null }> | null | undefined) {
  return receipts?.[0]?.status ?? null;
}
