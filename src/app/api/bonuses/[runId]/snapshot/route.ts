import { AuthError } from "@/lib/auth";
import { requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";

function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const { runId } = await params;
    const run = await withTenantTransaction(context, (db) => db.bonusRun.findFirst({
      where: { id: runId, organizationId: context.organizationId },
      relationLoadStrategy: "join",
      include: {
        seller: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        ruleSet: { select: { version: true, sourceFileName: true, sourceHash: true, rulesJson: true, effectiveStart: true, effectiveEnd: true } },
        items: {
          include: {
            payment: { select: { paidDate: true, status: true } },
            policy: { select: { policyNumber: true } },
            receipt: { select: { receiptNumber: true } },
          },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        },
      },
    }));
    if (!run) return Response.json({ error: "BONUS_RUN_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

    const filename = `bono-${run.programKey.toLowerCase()}-${run.year}-${run.periodNumber}-${run.seller.name.trim().replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-|-$/g, "") || "vendedor"}.json`;
    const snapshot = {
      exportedAt: new Date().toISOString(),
      organizationId: context.organizationId,
      close: {
        id: run.id,
        programKey: run.programKey,
        seller: run.seller,
        year: run.year,
        periodType: run.periodType,
        periodNumber: run.periodNumber,
        status: run.status,
        baseAmount: run.baseAmount.toString(),
        bonusRate: run.bonusRate?.toString() ?? null,
        bonusAmount: run.bonusAmount?.toString() ?? null,
        version: run.version,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        approvedBy: run.approvedBy,
        approvedAt: run.approvedAt?.toISOString() ?? null,
        reviewReasons: parseJson(run.reviewReasonsJson),
      },
      rules: {
        version: run.ruleSet.version,
        sourceFileName: run.ruleSet.sourceFileName,
        sourceHash: run.ruleSet.sourceHash,
        effectiveStart: run.ruleSet.effectiveStart.toISOString(),
        effectiveEnd: run.ruleSet.effectiveEnd.toISOString(),
        rules: parseJson(run.ruleSet.rulesJson),
      },
      snapshotJson: run.snapshotJson,
      snapshot: parseJson(run.snapshotJson),
      items: run.items.map((item) => ({
        id: item.id,
        paymentId: item.paymentId,
        paymentStatus: item.payment?.status ?? null,
        paidDate: item.payment?.paidDate?.toISOString() ?? null,
        receiptId: item.receiptId,
        receiptNumber: item.receipt?.receiptNumber ?? null,
        policyId: item.policyId,
        policyNumber: item.policy?.policyNumber ?? null,
        status: item.status,
        currency: item.currency,
        paidAmount: item.paidAmount?.toString() ?? null,
        netPremiumPaid: item.netPremiumPaid?.toString() ?? null,
        eligibleAmount: item.eligibleAmount?.toString() ?? null,
        conversionRate: item.conversionRate?.toString() ?? null,
        conversionDate: item.conversionDate?.toISOString().slice(0, 10) ?? null,
        reason: item.reason,
        evidenceJson: item.evidenceJson,
        evidence: parseJson(item.evidenceJson),
      })),
    };

    return new Response(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ error: "BONUS_SNAPSHOT_EXPORT_FAILED" }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
