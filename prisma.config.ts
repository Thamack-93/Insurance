import path from "node:path";
import { defineConfig } from "prisma/config";

const dbPath = path.join(process.cwd(), "data", "pg.sqlite");
const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl) ? databaseUrl : `file:${dbPath}`,
  },
});
