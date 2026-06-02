import { getDb } from "@/lib/db";
import { SYSTEM_USER_ID } from "@/lib/auth";

const PEDRO_EMAIL = "pedroagl93@gmail.com";

async function main() {
  const db = getDb();
  const pedro = await db.user.findUnique({
    where: { email: PEDRO_EMAIL },
    select: { id: true, name: true },
  });

  if (!pedro) {
    throw new Error(`No existe el usuario ${PEDRO_EMAIL}.`);
  }

  const clients = await db.client.updateMany({
    where: { portfolioOwnerId: null },
    data: { portfolioOwnerId: pedro.id },
  });
  const workItems = await db.workItem.updateMany({
    where: { assignedToId: null, client: { portfolioOwnerId: pedro.id } },
    data: { assignedToId: pedro.id },
  });

  await db.activityLog.create({
    data: {
      entityType: "Portfolio",
      entityId: pedro.id,
      action: "ASSIGN_EXISTING_PORTFOLIO",
      userId: SYSTEM_USER_ID,
      newValue: JSON.stringify({
        portfolioOwnerId: pedro.id,
        portfolioOwnerName: pedro.name,
        clientsAssigned: clients.count,
        workItemsAssigned: workItems.count,
      }),
    },
  });

  console.log(
    JSON.stringify(
      {
        portfolioOwnerId: pedro.id,
        portfolioOwnerName: pedro.name,
        clientsAssigned: clients.count,
        workItemsAssigned: workItems.count,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
