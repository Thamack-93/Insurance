import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { databasePath } from "../src/lib/files";
import { hashPassword } from "../src/lib/auth";

const adapter = new PrismaBetterSqlite3({ url: `file:${databasePath}` });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "pedroagl93@gmail.com";
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: "Pedro Gomez" },
    create: {
      email,
      name: "Pedro Gomez",
      passwordHash: hashPassword("Peter@123"),
    },
  });
  console.log(`Usuario listo: ${user.name} <${user.email}> (id=${user.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
