import { daysSince, today } from "../src/lib/dates";

import {
  closeDb,
  compactText,
  createDb,
  formatDateShort,
  getFlag,
  parseCliArgs,
  printTable,
} from "./_shared";

const priorityRank: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

async function main() {
  const args = parseCliArgs();
  const limit = Number(getFlag(args, "limit", "30"));
  const db = createDb();
  const now = today();

  const tasks = await db.task.findMany({
    where: { status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] } },
    include: { client: true, insurer: true, policy: true, receipt: true },
  });

  const sorted = [...tasks]
    .sort((left, right) => {
      const rankDelta = priorityRank[left.priority] - priorityRank[right.priority];
      if (rankDelta !== 0) return rankDelta;

      const leftDate = left.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDate = right.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftDate - rightDate;
    })
    .slice(0, limit);

  const byStatus = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});

  const byPriority = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.priority] = (acc[task.priority] ?? 0) + 1;
    return acc;
  }, {});

  const formatRow = (task: (typeof sorted)[number]) => ({
    Folio: task.folio,
    Titulo: task.title,
    Cliente: task.client?.fullName ?? "-",
    Poliza: task.policy?.policyNumber ?? "-",
    Aseguradora: task.insurer?.name ?? "-",
    Prioridad: task.priority,
    Estado: task.status,
    Vence: formatDateShort(task.dueDate),
    Atraso: task.dueDate && task.dueDate < now ? daysSince(task.dueDate) : "-",
    "Antiguedad": daysSince(task.startDate),
    Descripcion: compactText(task.description ?? task.notes, 60) || "-",
  });

  console.log("Pendientes abiertos");
  console.log(`Total abiertos: ${tasks.length}`);
  console.log(`Mostrando hasta ${limit} registros.`);
  console.log(`Vigentes al dia de hoy: ${tasks.filter((task) => task.dueDate === null || task.dueDate >= now).length}`);
  console.log(`Por prioridad: ${JSON.stringify(byPriority)}`);
  console.log(`Por estado: ${JSON.stringify(byStatus)}`);

  printTable("Pendientes abiertos", sorted.map(formatRow));

  console.log("");
  console.log(`Total de tareas mostradas: ${sorted.length}`);

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al listar los pendientes abiertos.");
  console.error(error);
  process.exit(1);
});
