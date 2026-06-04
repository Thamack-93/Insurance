import { getDb } from "@/lib/db";
import { SYSTEM_USER_ID } from "@/lib/auth";

const PEDRO_EMAIL = "pedroagl93@gmail.com";
const BROKER_DEMO_EMAIL = "broker@policydesk.local";

async function main() {
  const db = getDb();
  const pedro = await db.user.findUnique({
    where: { email: PEDRO_EMAIL },
    select: { id: true, name: true },
  });

  if (!pedro) {
    throw new Error(`No existe el usuario ${PEDRO_EMAIL}.`);
  }

  const result = await db.$transaction(async (tx) => {
    const clients = await tx.client.updateMany({
      where: { portfolioOwnerId: null },
      data: { portfolioOwnerId: pedro.id },
    });
    const workItems = await tx.workItem.updateMany({
      where: { assignedToId: null, client: { portfolioOwnerId: pedro.id } },
      data: { assignedToId: pedro.id },
    });

    const broker = await tx.user.findUnique({
      where: { email: BROKER_DEMO_EMAIL },
      select: { id: true, email: true, name: true },
    });

    let brokerDeleted = false;
    let brokerNotificationChannelsDeleted = 0;
    let brokerNotificationPreferencesDeleted = 0;
    if (broker) {
      const brokerOperationalCounts = {
        portfolioClients: await tx.client.count({ where: { portfolioOwnerId: broker.id } }),
        createdClients: await tx.client.count({ where: { createdById: broker.id } }),
        updatedClients: await tx.client.count({ where: { updatedById: broker.id } }),
        createdPolicies: await tx.policy.count({ where: { createdById: broker.id } }),
        updatedPolicies: await tx.policy.count({ where: { updatedById: broker.id } }),
        createdReceipts: await tx.receipt.count({ where: { createdById: broker.id } }),
        updatedReceipts: await tx.receipt.count({ where: { updatedById: broker.id } }),
        createdPayments: await tx.payment.count({ where: { createdById: broker.id } }),
        updatedPayments: await tx.payment.count({ where: { updatedById: broker.id } }),
        createdTasks: await tx.task.count({ where: { createdById: broker.id } }),
        updatedTasks: await tx.task.count({ where: { updatedById: broker.id } }),
        createdWorkItems: await tx.workItem.count({ where: { createdById: broker.id } }),
        updatedWorkItems: await tx.workItem.count({ where: { updatedById: broker.id } }),
        assignedWorkItems: await tx.workItem.count({ where: { assignedToId: broker.id } }),
        createdClaims: await tx.claim.count({ where: { createdById: broker.id } }),
        updatedClaims: await tx.claim.count({ where: { updatedById: broker.id } }),
        createdQuotes: await tx.quote.count({ where: { createdById: broker.id } }),
        updatedQuotes: await tx.quote.count({ where: { updatedById: broker.id } }),
        createdDocuments: await tx.document.count({ where: { createdById: broker.id } }),
        updatedDocuments: await tx.document.count({ where: { updatedById: broker.id } }),
      };
      const hasOperationalData = Object.values(brokerOperationalCounts).some((count) => count > 0);
      if (hasOperationalData) {
        throw new Error(`Broker Demo tiene datos operativos y no se borró: ${JSON.stringify(brokerOperationalCounts)}`);
      }

      brokerNotificationChannelsDeleted = await tx.notificationChannel.count({ where: { userId: broker.id } });
      brokerNotificationPreferencesDeleted = await tx.notificationPreference.count({ where: { userId: broker.id } });
      await tx.user.delete({ where: { id: broker.id } });
      brokerDeleted = true;
    }

    const payload = {
      portfolioOwnerId: pedro.id,
      portfolioOwnerName: pedro.name,
      clientsAssigned: clients.count,
      workItemsAssigned: workItems.count,
      brokerDeleted,
      brokerNotificationChannelsDeleted,
      brokerNotificationPreferencesDeleted,
    };

    await tx.activityLog.create({
      data: {
        entityType: "Portfolio",
        entityId: pedro.id,
        action: "ASSIGN_EXISTING_PORTFOLIO",
        userId: SYSTEM_USER_ID,
        newValue: JSON.stringify(payload),
      },
    });

    return payload;
  });

  console.log(JSON.stringify(result, null, 2));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
