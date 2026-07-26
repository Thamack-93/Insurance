import { closeDb, createDb } from "./_shared";

const db = createDb();

async function main() {
  try {
    const [totalClients, clientsWithBirthDate, personsWithBirthDate, eligiblePersons, eligiblePersonsWithBirthDate, eligibleWithoutBirthDate, eligibleWithoutOwner] =
      await Promise.all([
      db.client.count(),
      db.client.count({ where: { birthDate: { not: null } } }),
      db.client.count({ where: { type: "PERSON", birthDate: { not: null } } }),
      db.client.count({
        where: {
          type: "PERSON",
          status: "ACTIVE",
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      db.client.count({
        where: {
          type: "PERSON",
          status: "ACTIVE",
          birthDate: { not: null },
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      db.client.count({
        where: {
          type: "PERSON",
          status: "ACTIVE",
          birthDate: null,
          policies: { some: { status: "ACTIVE" } },
        },
      }),
      db.client.count({
        where: {
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
