import { closeDb, createDb, parseCliArgs, requireOrganizationId } from "./_shared";

const db = createDb();

async function main() {
  const organizationId = requireOrganizationId(parseCliArgs());
  try {
    const [totalClients, clientsWithBirthDate, personsWithBirthDate, eligiblePersons, eligiblePersonsWithBirthDate, eligibleWithoutBirthDate, eligibleWithoutOwner] =
      await Promise.all([
      db.client.count({ where: { organizationId } }),
      db.client.count({ where: { organizationId, birthDate: { not: null } } }),
      db.client.count({ where: { organizationId, type: "PERSON", birthDate: { not: null } } }),
      db.client.count({
        where: {
          organizationId,
          type: "PERSON",
          status: "ACTIVE",
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      db.client.count({
        where: {
          organizationId,
          type: "PERSON",
          status: "ACTIVE",
          birthDate: { not: null },
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      db.client.count({
        where: {
          organizationId,
          type: "PERSON",
          status: "ACTIVE",
          birthDate: null,
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      db.client.count({
        where: {
          organizationId,
          type: "PERSON",
          status: "ACTIVE",
          portfolioOwnerId: null,
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      ]);

    console.log(JSON.stringify({
      totalClients,
      clientsWithBirthDate,
      personsWithBirthDate,
      eligiblePersons,
      eligiblePersonsWithBirthDate,
      eligibleWithoutBirthDate,
      eligibleWithoutOwner,
    }, null, 2));
  } finally {
    await closeDb(db);
  }
}

void main();
