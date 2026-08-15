import { addYears } from "date-fns";

import { getDb } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { parseCliArgs, requireOrganizationId } from "./_shared.ts";

type Args = {
  policyId?: string;
  policyNumber?: string;
};

type PolicyTerm = {
  id: string;
  policyNumber: string;
  familyRootId: string | null;
  clientId: string;
  insurerId: string;
  policyType: string;
  status: string;
  startDate: Date;
  endDate: Date;
  premiumAmount: unknown;
  currency: string;
  paymentFrequency: string;
  paymentPlan: string | null;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  notes: string | null;
};

function parseArgs(argv = process.argv.slice(2)): Args {
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    if (token === "--policy-id") {
      args.policyId = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--policy-id=")) {
      args.policyId = token.slice("--policy-id=".length);
      continue;
    }

    if (token === "--policy-number") {
      args.policyNumber = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--policy-number=")) {
      args.policyNumber = token.slice("--policy-number=".length);
    }
  }

  return args;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sameDate(left: Date, right: Date) {
  return dateKey(left) === dateKey(right);
}

function asDecimalNumber(value: unknown) {
  return toNumber(value);
}

function deriveTermStatus(index: number, totalTerms: number, termStart: Date, termEnd: Date) {
  const now = new Date();
  if (index < totalTerms - 1) {
    return "RENEWED";
  }
  if (termEnd < now) {
    return "EXPIRED";
  }
  if (termStart <= now && termEnd >= now) {
    return "ACTIVE";
  }
  return "PENDING";
}

function findTermIndex(startDate: Date, familyStart: Date, termCount: number) {
  for (let index = 0; index < termCount; index += 1) {
    const termStart = addYears(familyStart, index);
    const termEnd = addYears(familyStart, index + 1);
    const receiptDateKey = dateKey(startDate);
    if (receiptDateKey >= dateKey(termStart) && receiptDateKey < dateKey(termEnd)) {
      return index;
    }
  }

  return Math.max(termCount - 1, 0);
}

async function main() {
  const args = parseArgs();
  const organizationId = requireOrganizationId(parseCliArgs());
  const db = getDb();

  const initialPolicy = args.policyId
    ? await db.policy.findFirst({ where: { id: args.policyId, organizationId } })
    : await db.policy.findFirst({
        where: { organizationId, policyNumber: args.policyNumber ?? "157476" },
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      });

  if (!initialPolicy) {
    throw new Error("No se encontró la póliza base para dividir.");
  }

  const familyPolicies = await db.policy.findMany({
    where: {
      organizationId,
      policyNumber: initialPolicy.policyNumber,
      clientId: initialPolicy.clientId,
      insurerId: initialPolicy.insurerId,
    },
    include: {
      receipts: {
        orderBy: [{ periodStartDate: "asc" }, { periodEndDate: "asc" }, { receiptNumber: "asc" }],
        include: {
          payments: true,
        },
      },
      payments: true,
      commissions: true,
      documents: { select: { id: true } },
    },
    orderBy: [{ startDate: "asc" }, { endDate: "asc" }, { createdAt: "asc" }],
  });

  const familyStart = familyPolicies.reduce((earliest, policy) => (policy.startDate < earliest ? policy.startDate : earliest), familyPolicies[0].startDate);
  const familyEnd = familyPolicies.reduce((latest, policy) => (policy.endDate > latest ? policy.endDate : latest), familyPolicies[0].endDate);

  const terms: Array<{ startDate: Date; endDate: Date }> = [];
  for (let index = 0; addYears(familyStart, index) < familyEnd; index += 1) {
    const startDate = addYears(familyStart, index);
    const endDate = addYears(familyStart, index + 1);
    terms.push({
      startDate,
      endDate: endDate > familyEnd ? familyEnd : endDate,
    });
  }

  if (terms.length === 0) {
    throw new Error("No se pudieron derivar vigencias para la póliza.");
  }

  const summary = {
    rootPolicyId: initialPolicy.id,
    policyNumber: initialPolicy.policyNumber,
    terms: terms.length,
    receiptsMoved: 0,
    paymentsMoved: 0,
    commissionsMoved: 0,
    policiesUpdated: 0,
    policiesCreated: 0,
  };

  await db.$transaction(async (tx) => {
    const rootPolicy = familyPolicies[0];
    const termPolicies: PolicyTerm[] = [];

    for (let index = 0; index < terms.length; index += 1) {
      const term = terms[index];
      const termReceipts = familyPolicies
        .flatMap((policy) => policy.receipts)
        .filter((receipt) => {
          const receiptDateKey = dateKey(receipt.periodStartDate);
          return receiptDateKey >= dateKey(term.startDate) && receiptDateKey < dateKey(term.endDate);
        });
      const premiumAmount = termReceipts.reduce((sum, receipt) => sum + asDecimalNumber(receipt.amount), 0);
      const existingPolicy =
        familyPolicies.find((policy) => sameDate(policy.startDate, term.startDate) && sameDate(policy.endDate, term.endDate)) ??
        (index === 0 ? rootPolicy : null);

      if (existingPolicy) {
        const updated = await tx.policy.update({
          where: { id: existingPolicy.id, organizationId },
          data: {
            organizationId,
            policyNumber: rootPolicy.policyNumber,
            familyRootId: index === 0 ? null : rootPolicy.id,
            clientId: rootPolicy.clientId,
            insurerId: rootPolicy.insurerId,
            policyType: rootPolicy.policyType,
            status: deriveTermStatus(index, terms.length, term.startDate, term.endDate),
            startDate: term.startDate,
            endDate: term.endDate,
            premiumAmount,
            currency: rootPolicy.currency,
            paymentFrequency: rootPolicy.paymentFrequency,
            paymentPlan: rootPolicy.paymentPlan,
            insuredObject: rootPolicy.insuredObject,
            beneficiaryInfo: rootPolicy.beneficiaryInfo,
            notes: rootPolicy.notes,
          },
        });
        termPolicies.push(updated);
        summary.policiesUpdated += 1;
      } else {
        const created = await tx.policy.create({
          data: {
            organizationId,
            policyNumber: rootPolicy.policyNumber,
            familyRootId: index === 0 ? null : rootPolicy.id,
            clientId: rootPolicy.clientId,
            insurerId: rootPolicy.insurerId,
            policyType: rootPolicy.policyType,
            status: deriveTermStatus(index, terms.length, term.startDate, term.endDate),
            startDate: term.startDate,
            endDate: term.endDate,
            premiumAmount,
            currency: rootPolicy.currency,
            paymentFrequency: rootPolicy.paymentFrequency,
            paymentPlan: rootPolicy.paymentPlan,
            insuredObject: rootPolicy.insuredObject,
            beneficiaryInfo: rootPolicy.beneficiaryInfo,
            notes: rootPolicy.notes,
          },
        });
        termPolicies.push(created);
        summary.policiesCreated += 1;
      }
    }

    const receiptById = new Map<string, { policyId: string; clientId: string; insurerId: string }>();
    for (const policy of familyPolicies) {
      for (const receipt of policy.receipts) {
        const termIndex = findTermIndex(receipt.periodStartDate, familyStart, terms.length);
        const targetPolicy = termPolicies[termIndex] ?? termPolicies[termPolicies.length - 1];
        receiptById.set(receipt.id, {
          policyId: targetPolicy.id,
          clientId: targetPolicy.clientId,
          insurerId: targetPolicy.insurerId,
        });
      }
    }

    for (const policy of familyPolicies) {
      for (const receipt of policy.receipts) {
        const target = receiptById.get(receipt.id);
        if (!target) continue;

        await tx.receipt.update({
          where: { id: receipt.id, organizationId },
          data: {
            policyId: target.policyId,
            clientId: target.clientId,
            insurerId: target.insurerId,
          },
        });
        summary.receiptsMoved += 1;

        for (const payment of receipt.payments) {
          await tx.payment.update({
            where: { id: payment.id, organizationId },
            data: {
              policyId: target.policyId,
              clientId: target.clientId,
            },
          });
          summary.paymentsMoved += 1;
        }
      }
    }

    for (const commission of familyPolicies.flatMap((policy) => policy.commissions)) {
      let targetPolicy = null as (typeof termPolicies)[number] | null;
      if (commission.receiptId) {
        const receipt = familyPolicies.flatMap((policy) => policy.receipts).find((item) => item.id === commission.receiptId);
        if (receipt) {
          const termIndex = findTermIndex(receipt.periodStartDate, familyStart, terms.length);
          targetPolicy = termPolicies[termIndex] ?? null;
        }
      }

      if (!targetPolicy) {
        const termIndex = findTermIndex(commission.expectedDate, familyStart, terms.length);
        targetPolicy = termPolicies[termIndex] ?? null;
      }

      if (!targetPolicy) continue;

      await tx.commission.update({
        where: { id: commission.id, organizationId },
        data: {
          policyId: targetPolicy.id,
          clientId: targetPolicy.clientId,
          insurerId: targetPolicy.insurerId,
        },
      });
      summary.commissionsMoved += 1;
    }

    await tx.activityLog.create({
      data: {
        organizationId,
        entityType: "Policy",
        entityId: rootPolicy.id,
        action: "SPLIT_POLICY_VIGENCIES",
        oldValue: JSON.stringify({
          policyNumber: rootPolicy.policyNumber,
          startDate: rootPolicy.startDate,
          endDate: rootPolicy.endDate,
          premiumAmount: rootPolicy.premiumAmount.toString(),
          terms: familyPolicies.length,
        }),
        newValue: JSON.stringify(summary),
        userId: "system-user-0000",
      },
    });
  });

  console.log(JSON.stringify(summary, null, 2));
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
