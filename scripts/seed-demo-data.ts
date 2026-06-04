import { addDays, subDays } from "date-fns";
import type {
  AlertSeverity,
  PaymentFrequency,
  PolicyType,
  Priority,
  QuoteStatus,
  TaskType,
  WorkItemStatus,
  WorkItemType,
} from "../src/lib/domain-values";

import {
  backupDatabase,
  closeDb,
  createDb,
  ensureDataDirs,
  parseCliArgs,
  toBooleanValue,
} from "./_shared.ts";
import { ensureNotificationDefaultsForUser } from "../src/lib/notification-foundation.ts";

async function main() {
  const args = parseCliArgs();
  const dryRun = toBooleanValue(args.flags["dry-run"] ?? args.flags["dryRun"]) ?? false;
  const db = createDb();
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const summary = {
    insurers: 0,
    clients: 0,
    policies: 0,
    receipts: 0,
    payments: 0,
    workItems: 0,
    claims: 0,
    quotes: 0,
    alerts: 0,
    logs: 0,
  };

  const insurerNames = ["AXA Seguros", "GNP Seguros", "Qualitas"];
  const policyTypes = [
    "AUTO",
    "GMM",
    "VIDA",
    "DANOS",
    "FIANZAS",
    "HOGAR",
    "EMPRESARIAL",
    "OTRO",
  ] as const satisfies readonly PolicyType[];
  const paymentFrequencies = [
    "MONTHLY",
    "QUARTERLY",
    "SEMIANNUAL",
    "ANNUAL",
    "SINGLE",
    "OTHER",
  ] as const satisfies readonly PaymentFrequency[];
  const workItemTypesDemo = [
    "GENERAL",
    "DOCUMENT",
    "RENEWAL",
    "COMMISSION",
    "QUOTE",
    "PAYMENT",
  ] as const satisfies readonly TaskType[];
  const workItemStatuses = [
    "OPEN",
    "IN_PROGRESS",
    "WAITING_CLIENT",
    "WAITING_INSURER",
    "WAITING_DOCUMENT",
    "SENT",
  ] as const satisfies readonly WorkItemStatus[];
  const workItemTypes = ["TASK"] as const satisfies readonly WorkItemType[];
  const priorities = ["URGENT", "HIGH", "MEDIUM", "LOW", "MEDIUM", "HIGH"] as const satisfies readonly Priority[];
  const quoteTypes = ["AUTO", "HOGAR"] as const satisfies readonly PolicyType[];
  const quoteStatuses = ["REQUESTED", "SENT"] as const satisfies readonly QuoteStatus[];
  const alertSeverities = ["CRITICAL", "WARNING", "WARNING", "WARNING"] as const satisfies readonly AlertSeverity[];
  const clientNames = [
    "Valeria Pineda",
    "Grupo Lirio Azul SA de CV",
    "Carlos Mendoza",
    "Martha Robles",
    "Orion Logistica Integral",
    "Fernanda Campos",
  ];

  if (dryRun) {
    console.log("Seed demo de PolicyDesk");
    console.log("Modo simulacion activado: no se escribira nada.");
    console.log(`Se borrarian y recrearian ${clientNames.length} clientes, ${insurerNames.length} aseguradoras, una cartera base y la cola demo de WorkItems.`);
    await closeDb(db);
    return;
  }

  await ensureDataDirs();
  const backup = await backupDatabase();
  if (backup) {
    console.log(`Backup previo creado: ${backup}`);
  }

  await db.receipt.updateMany({ data: { documentId: null } });
  await db.alert.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationPreference.deleteMany();
  await db.notificationChannel.deleteMany();
  await db.activityLog.deleteMany();
  await db.payment.deleteMany();
  await db.commission.deleteMany();
  await db.document.deleteMany();
  await db.workItem.deleteMany();
  await db.claim.deleteMany();
  await db.quote.deleteMany();
  await db.receipt.deleteMany();
  await db.policy.deleteMany();
  await db.client.deleteMany();
  await db.insurer.deleteMany();

  const insurers = [];
  for (const [index, name] of insurerNames.entries()) {
    const insurer = await db.insurer.create({
      data: {
        name,
        portalUrl: `https://portal.${slug(name)}.example`,
        agentPortalUrl: `https://agentes.${slug(name)}.example`,
        contactName: ["Mariana Ruiz", "Roberto Silva", "Ana Cano"][index],
        contactEmail: `contacto.${index + 1}@aseguradora.example`,
        contactPhone: `55 410${index} 22${index}0`,
        notes: "Contacto demo para seguimiento operativo.",
      },
    });
    insurers.push(insurer);
    summary.insurers += 1;
  }

  const clients = [];
  for (const [index, fullName] of clientNames.entries()) {
    const client = await db.client.create({
      data: {
        fullName,
        type: fullName.includes("SA") || fullName.includes("Integral") ? "COMPANY" : "PERSON",
        email: `${slug(fullName)}@example.com`,
        phone: `55 ${3200 + index} ${4400 + index}`,
        secondaryPhone: index % 2 === 0 ? `55 ${8700 + index} ${1100 + index}` : null,
        rfc: `RFC${String(index + 1).padStart(9, "0")}`,
        address: `Av. Reforma ${100 + index}, CDMX`,
        preferredContactMethod: index % 2 === 0 ? "WhatsApp" : "Email",
        notes: "Cliente demo de cartera PolicyDesk.",
        status: index === clientNames.length - 1 ? "INACTIVE" : "ACTIVE",
      },
    });
    clients.push(client);
    summary.clients += 1;
  }

  const policies = [];
  for (let index = 0; index < 8; index += 1) {
    const client = clients[index % clients.length];
    const insurer = insurers[index % insurers.length];
    const startDate = subDays(base, 240 - index * 14);
    const endDate = addDays(startDate, 365);
    const policy = await db.policy.create({
      data: {
        policyNumber: `POL-DEMO-${1000 + index}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: policyTypes[index],
        status: index === 6 ? "PENDING" : "ACTIVE",
        startDate,
        endDate,
        premiumAmount: 8500 + index * 1250,
        currency: index % 3 === 0 ? "USD" : "MXN",
        paymentFrequency: paymentFrequencies[index % paymentFrequencies.length],
        paymentPlan: index % 2 === 0 ? "Cargo domiciliado" : "Pago referenciado",
        insuredObject: `Activo demo ${index + 1}`,
        beneficiaryInfo: index % 2 === 0 ? "Beneficiarios en expediente digital." : null,
        notes: index % 3 === 0 ? "Revisar condiciones especiales antes de renovacion." : null,
      },
    });
    policies.push(policy);
    summary.policies += 1;
  }

  const receipts = [];
  for (let index = 0; index < 10; index += 1) {
    const policy = policies[index % policies.length];
    const dueDate = addDays(base, [-18, -7, -2, 0, 4, 9, 15, 24, 36, 48][index]);
    const paid = index < 4;
    const receipt = await db.receipt.create({
      data: {
        receiptNumber: `REC-DEMO-${2000 + index}`,
        policyId: policy.id,
        clientId: policy.clientId,
        insurerId: policy.insurerId,
        periodStartDate: subDays(dueDate, 30),
        periodEndDate: addDays(dueDate, 30),
        dueDate,
        amount: 1800 + index * 450,
        currency: policy.currency,
        status: paid ? "PAID" : dueDate < base ? "OVERDUE" : "PENDING",
        paidDate: paid ? addDays(dueDate, 1) : null,
        paymentMethod: paid ? ["Transferencia", "SPEI", "Tarjeta"][index % 3] : null,
        notes: paid ? "Recibo pagado demo." : "Pendiente de seguimiento demo.",
      },
    });
    receipts.push(receipt);
    summary.receipts += 1;
  }

  for (let index = 0; index < 4; index += 1) {
    const receipt = receipts[index];
    await db.payment.create({
      data: {
        receiptId: receipt.id,
        policyId: receipt.policyId,
        clientId: receipt.clientId,
        amount: receipt.amount,
        currency: receipt.currency,
        paidDate: receipt.paidDate ?? base,
        paymentMethod: receipt.paymentMethod ?? "Transferencia",
        reference: `SPEI-${90000 + index}`,
        notes: index % 2 === 0 ? "Pago confirmado por cliente." : null,
      },
    });
    summary.payments += 1;
  }

  for (let index = 0; index < 6; index += 1) {
    const policy = policies[index % policies.length];
    const sourceId = `PD-2026-${String(index + 1).padStart(4, "0")}`;
    await db.workItem.create({
      data: {
        sourceType: null,
        sourceId,
        workItemType: workItemTypes[0],
        taskType: workItemTypesDemo[index],
        status: workItemStatuses[index],
        priority: priorities[index],
        folio: sourceId,
        title: ["Confirmar pago", "Solicitar documento", "Preparar renovacion", "Validar comision", "Enviar cotizacion", "Dar seguimiento"][index],
        description: "Pendiente demo para probar la operacion diaria de PolicyDesk.",
        entityType: "WorkItem",
        entityId: sourceId,
        clientId: policy.clientId,
        policyId: policy.id,
        insurerId: policy.insurerId,
        receiptId: index % 2 === 0 ? receipts[index % receipts.length].id : null,
        startDate: subDays(base, 14 + index),
        dueDate: addDays(base, [-8, -1, 2, 7, 13, 21][index]),
        notes: index % 3 === 0 ? "Requiere seguimiento hoy." : null,
      },
    });
    summary.workItems += 1;
  }

  for (let index = 0; index < 2; index += 1) {
    const policy = policies[index + 1];
    await db.claim.create({
      data: {
        folio: `SIN-DEMO-${String(index + 1).padStart(3, "0")}`,
        clientId: policy.clientId,
        policyId: policy.id,
        insurerId: policy.insurerId,
        claimType: ["Cristales", "Gastos medicos"][index],
        description: "Siniestro demo para pruebas operativas.",
        status: index === 0 ? "OPEN" : "IN_PROGRESS",
        incidentDate: subDays(base, 20 + index),
        reportedDate: subDays(base, 18 + index),
        closedDate: null,
        amountClaimed: 15000 + index * 4000,
        amountPaid: null,
      },
    });
    summary.claims += 1;
  }

  for (let index = 0; index < 2; index += 1) {
    const client = clients[index + 2];
    await db.quote.create({
      data: {
        clientId: client.id,
        insurerId: index % 2 === 0 ? insurers[index].id : null,
        policyType: quoteTypes[index],
        status: quoteStatuses[index],
        requestedDate: subDays(base, 12 + index),
        sentDate: index === 1 ? subDays(base, 5) : null,
        validUntil: addDays(base, 14 + index * 7),
        quotedAmount: 9800 + index * 2400,
        notes: "Cotizacion demo para seguimiento comercial.",
      },
    });
    summary.quotes += 1;
  }

  for (let index = 0; index < 4; index += 1) {
    const policy = policies[index % policies.length];
    await db.alert.create({
      data: {
        alertType: ["RECEIPT_OVERDUE", "RENEWAL_WITHOUT_TASK", "COMMISSION_OVERDUE", "CLIENT_MISSING_CONTACT"][index],
        severity: alertSeverities[index],
        title: ["Recibo vencido", "Poliza sin seguimiento", "Comision vencida", "Cliente incompleto"][index],
        description: "Alerta demo generada para mostrar riesgos operativos.",
        entityType: index % 2 === 0 ? "Policy" : "Receipt",
        entityId: index % 2 === 0 ? policy.id : receipts[index].id,
        status: "OPEN",
      },
    });
    summary.alerts += 1;
  }

  for (let index = 0; index < 8; index += 1) {
    const policy = policies[index % policies.length];
    await db.activityLog.create({
      data: {
        entityType: index % 3 === 0 ? "Client" : index % 3 === 1 ? "Policy" : "Receipt",
        entityId: index % 3 === 0 ? policy.clientId : index % 3 === 1 ? policy.id : receipts[index % receipts.length].id,
        action: ["Cliente creado", "Poliza creada", "Recibo creado", "Pago registrado"][index % 4],
        oldValue: index % 2 === 0 ? "Pendiente" : null,
        newValue: index % 2 === 0 ? "Actualizado" : null,
        createdAt: subDays(base, index),
        userId: "system-user-0000",
      },
    });
    summary.logs += 1;
  }

  const activeUsers = await db.user.findMany({
    where: { active: true },
    select: { id: true },
  });
  for (const user of activeUsers) {
    await ensureNotificationDefaultsForUser(user.id, db);
  }

  console.log("Seed demo de PolicyDesk");
  console.log("Datos recreados con exito.");
  console.log(`Insurers: ${summary.insurers}`);
  console.log(`Clients: ${summary.clients}`);
  console.log(`Policies: ${summary.policies}`);
  console.log(`Receipts: ${summary.receipts}`);
  console.log(`Payments: ${summary.payments}`);
  console.log(`WorkItems: ${summary.workItems}`);
  console.log(`Claims: ${summary.claims}`);
  console.log(`Quotes: ${summary.quotes}`);
  console.log(`Alerts: ${summary.alerts}`);
  console.log(`Activity logs: ${summary.logs}`);

  await closeDb(db);
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "");
}

main().catch((error) => {
  console.error("Error al generar los datos demo.");
  console.error(error);
  process.exit(1);
});
