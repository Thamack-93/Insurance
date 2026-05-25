import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { addDays, subDays } from "date-fns";
import { PrismaClient } from "../src/generated/prisma/client";
import type { PaymentFrequency, Policy, Priority, Receipt, TaskStatus } from "../src/generated/prisma/client";
import { hashPassword, SYSTEM_USER_ID } from "../src/lib/auth";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const baseDate = new Date("2026-05-01T00:00:00.000Z");

const policyTypes = [
  "AUTO",
  "GMM",
  "VIDA",
  "DANOS",
  "FIANZAS",
  "HOGAR",
  "RESPONSABILIDAD_CIVIL",
  "EMPRESARIAL",
  "ACCIDENTES",
  "OTRO",
] as const;

const taskTypes = [
  "GENERAL",
  "CLAIM",
  "QUOTE",
  "RENEWAL",
  "PAYMENT",
  "DOCUMENT",
  "COMMISSION",
  "OTHER",
] as const;

const paymentFrequencies = [
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
  "SINGLE",
] as const satisfies readonly PaymentFrequency[];

const taskStatuses = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CLIENT",
  "WAITING_INSURER",
  "WAITING_DOCUMENT",
  "SENT",
] as const satisfies readonly TaskStatus[];

const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const satisfies readonly Priority[];

async function main() {
  await resetDatabase();

  await prisma.user.create({
    data: {
      id: SYSTEM_USER_ID,
      email: "system@policydesk.local",
      name: "Sistema",
      passwordHash: "!disabled",
      role: "ADMIN",
      active: false,
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: "admin@policydesk.local",
      name: "Admin Demo",
      passwordHash: hashPassword("admin1234"),
      role: "ADMIN",
      active: true,
    },
  });

  const brokerUser = await prisma.user.create({
    data: {
      email: "broker@policydesk.local",
      name: "Broker Demo",
      passwordHash: hashPassword("broker1234"),
      role: "AGENT",
      active: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "pedroagl93@gmail.com" },
    update: { name: "Pedro Gomez", role: "ADMIN", active: true },
    create: {
      email: "pedroagl93@gmail.com",
      name: "Pedro Gomez",
      passwordHash: hashPassword("Peter@123"),
      role: "ADMIN",
      active: true,
    },
  });

  const audit = { createdById: adminUser.id, updatedById: brokerUser.id };

  const insurers = await Promise.all(
    [
      "AXA Seguros",
      "GNP Seguros",
      "Qualitas",
      "Mapfre Mexico",
      "Chubb",
      "Zurich",
    ].map((name, index) =>
      prisma.insurer.create({
        data: {
          name,
          portalUrl: `https://portal.${slug(name)}.example`,
          agentPortalUrl: `https://agentes.${slug(name)}.example`,
          contactName: ["Mariana Ruiz", "Roberto Silva", "Claudia Ibarra", "Jorge Lujan", "Ana Cano", "Sofia Marin"][index],
          contactEmail: `contacto.${index + 1}@aseguradora.example`,
          contactPhone: `55 410${index} 22${index}0`,
          notes: "Contacto demo para seguimiento operativo.",
        },
      }),
    ),
  );

  const clientNames = [
    "Valeria Pineda",
    "Grupo Lirio Azul SA de CV",
    "Carlos Mendoza",
    "Martha Robles",
    "Orion Logistica Integral",
    "Diego Salazar",
    "Fernanda Campos",
    "Talleres Norte MX",
    "Sofia Aguilar",
    "Eduardo Treviño",
    "Casa Brava Desarrollos",
    "Lucia Herrera",
  ];

  const clients = await Promise.all(
    clientNames.map((fullName, index) =>
      prisma.client.create({
        data: {
          fullName,
          type: fullName.includes("SA") || fullName.includes("Orion") || fullName.includes("Talleres") || fullName.includes("Casa")
            ? "COMPANY"
            : "PERSON",
          email: index === 8 ? null : `${slug(fullName)}@example.com`,
          phone: index === 10 ? null : `55 ${3200 + index} ${4400 + index}`,
          secondaryPhone: index % 3 === 0 ? `55 ${8700 + index} ${1100 + index}` : null,
          rfc: index % 4 === 0 ? null : `RFC${String(index + 1).padStart(9, "0")}`,
          address: index % 5 === 0 ? null : `Av. Reforma ${100 + index}, CDMX`,
          preferredContactMethod: index % 2 === 0 ? "WhatsApp" : "Email",
          notes: index === 3 ? "Cliente con seguimiento pendiente por renovacion." : "Cliente demo de cartera PolicyDesk.",
          status: index === 11 ? "INACTIVE" : "ACTIVE",
          ...audit,
        },
      }),
    ),
  );

  const referralAssignments = [
    { clientIndex: 0, referidorIndex: 1 },
    { clientIndex: 2, referidorIndex: 1 },
    { clientIndex: 5, referidorIndex: 4 },
    { clientIndex: 11, referidorIndex: 10 },
  ] as const;

  for (const assignment of referralAssignments) {
    await prisma.client.update({
      where: { id: clients[assignment.clientIndex].id },
      data: {
        referidorId: clients[assignment.referidorIndex].id,
      },
    });
  }

  const policies: Policy[] = [];

  for (let index = 0; index < 25; index += 1) {
    const client = clients[index % clients.length];
    const insurer = insurers[index % insurers.length];
    const startDate = subDays(baseDate, 330 - index * 7);
    const endDate = addDays(startDate, 365);
    const renewalOffsets = [-20, 3, 9, 18, 34, 57, 88, 120, null, 44];
    const renewalOffset = renewalOffsets[index % renewalOffsets.length];

    policies.push(
      await prisma.policy.create({
        data: {
          policyNumber: index === 24 ? "POL-AUTO-1000" : `POL-${policyTypes[index % policyTypes.length]}-${1000 + index}`,
          clientId: client.id,
          insurerId: insurer.id,
          policyType: policyTypes[index % policyTypes.length],
          status: index === 7 ? "EXPIRED" : index === 14 ? "PENDING" : "ACTIVE",
          startDate,
          endDate: index === 7 ? subDays(baseDate, 15) : endDate,
          renewalDate: renewalOffset === null ? null : addDays(baseDate, renewalOffset),
          premiumAmount: 8500 + index * 2150,
          currency: index % 9 === 0 ? "USD" : "MXN",
          paymentFrequency: paymentFrequencies[index % paymentFrequencies.length],
          paymentPlan: index % 4 === 0 ? "Cargo domiciliado" : "Pago referenciado",
          insuredObject: insuredObjectFor(policyTypes[index % policyTypes.length], index),
          beneficiaryInfo: index % 3 === 0 ? "Beneficiarios en expediente digital." : null,
          notes: index % 6 === 0 ? "Revisar condiciones especiales antes de renovacion." : null,
          ...audit,
        },
      }),
    );
  }

  const receipts: Receipt[] = [];
  const dueOffsets = [-25, -9, -2, 0, 3, 6, 11, 15, 28, 52, 70, 88];

  for (let index = 0; index < 50; index += 1) {
    const policy = policies[index % policies.length];
    const dueDate = addDays(baseDate, dueOffsets[index % dueOffsets.length]);
    const paid = index < 20;
    const status = paid ? "PAID" : dueDate < baseDate ? "OVERDUE" : "PENDING";

    receipts.push(
      await prisma.receipt.create({
        data: {
          receiptNumber: index === 49 ? receipts[0].receiptNumber : `REC-${String(2000 + index).padStart(5, "0")}`,
          policyId: policy.id,
          clientId: policy.clientId,
          insurerId: policy.insurerId,
          periodStartDate: subDays(dueDate, 30),
          periodEndDate: addDays(dueDate, 30),
          dueDate,
          amount: 1800 + (index % 12) * 975,
          currency: policy.currency,
          status,
          paidDate: paid ? addDays(dueDate, index % 4) : null,
          paymentMethod: paid ? ["Transferencia", "Tarjeta", "SPEI"][index % 3] : null,
          notes: status === "OVERDUE" ? "Recibo vencido sin pago registrado." : null,
          ...audit,
        },
      }),
    );
  }

  for (let index = 0; index < 20; index += 1) {
    const receipt = receipts[index];
    await prisma.payment.create({
      data: {
        receiptId: receipt.id,
        policyId: receipt.policyId,
        clientId: receipt.clientId,
        amount: receipt.amount,
        currency: receipt.currency,
        paidDate: receipt.paidDate ?? baseDate,
        paymentMethod: receipt.paymentMethod ?? "Transferencia",
        reference: `SPEI-${90000 + index}`,
        notes: index % 5 === 0 ? "Pago confirmado por cliente, comprobante pendiente." : null,
        ...audit,
      },
    });
  }

  const documents = [];

  for (let index = 0; index < 12; index += 1) {
    const policy = policies[index % policies.length];
    const receipt = receipts[index % receipts.length];
    const isReceiptProof = index >= 8 && index <= 10;
    const isOrphan = index === 11;

    documents.push(
      await prisma.document.create({
        data: {
          clientId: isOrphan ? null : policy.clientId,
          policyId: isReceiptProof || isOrphan ? null : policy.id,
          receiptId: isReceiptProof ? receipt.id : null,
          documentType: isReceiptProof ? "PAYMENT_PROOF" : index === 6 ? "ID" : isOrphan ? "OTHER" : "POLICY",
          fileName: isReceiptProof ? `comprobante-${receipt.receiptNumber}.pdf` : `poliza-${policy.policyNumber}.pdf`,
          filePath: `data/documents/demo/${isReceiptProof ? "receipts" : "policies"}/${index + 1}.pdf`,
          mimeType: "application/pdf",
          uploadedAt: subDays(baseDate, index * 2),
          notes: isOrphan ? "Documento demo sin asociacion para probar calidad de datos." : "Ruta simulada de documento local.",
          ...audit,
        },
      }),
    );
  }

  for (let index = 8; index <= 10; index += 1) {
    await prisma.receipt.update({
      where: { id: receipts[index].id },
      data: { documentId: documents[index].id },
    });
  }

  for (let index = 0; index < 25; index += 1) {
    const policy = policies[index];
    const receipt = receipts[index];
    const expectedDate = addDays(baseDate, [-18, -4, 4, 13, 29, 49][index % 6]);
    const paid = index % 5 === 0;

    await prisma.commission.create({
      data: {
        policyId: policy.id,
        receiptId: receipt.id,
        clientId: policy.clientId,
        insurerId: policy.insurerId,
        expectedAmount: 600 + index * 180,
        actualAmount: paid ? 580 + index * 175 : null,
        percentage: 10 + (index % 6),
        status: paid ? "PAID" : expectedDate < baseDate ? "OVERDUE" : index % 2 === 0 ? "EXPECTED" : "PENDING",
        expectedDate,
        paidDate: paid ? addDays(expectedDate, 2) : null,
        notes: paid ? "Comision cobrada." : "Comision pendiente de conciliacion.",
      },
    });
  }

  for (let index = 0; index < 30; index += 1) {
    const policy = policies[index % policies.length];
    const startDate = subDays(baseDate, index + 2);
    const dueDate = addDays(baseDate, [-12, -3, 0, 4, 9, 15, 23][index % 7]);
    const status = taskStatuses[index % taskStatuses.length];

    await prisma.task.create({
      data: {
        folio: `PD-${new Date(baseDate).getUTCFullYear()}-${String(index + 1).padStart(4, "0")}`,
        clientId: policy.clientId,
        policyId: policy.id,
        insurerId: policy.insurerId,
        receiptId: index % 3 === 0 ? receipts[index % receipts.length].id : null,
        title: taskTitle(index),
        description: "Pendiente demo para probar la operacion diaria de PolicyDesk.",
        taskType: taskTypes[index % taskTypes.length],
        status,
        priority: priorities[index % priorities.length],
        startDate,
        dueDate,
        notes: index % 4 === 0 ? "Requiere seguimiento hoy." : null,
        ...audit,
      },
    });
  }

  for (let index = 0; index < 4; index += 1) {
    const policy = policies[index + 2];
    await prisma.claim.create({
      data: {
        folio: `SIN-2026-${String(index + 1).padStart(3, "0")}`,
        clientId: policy.clientId,
        policyId: policy.id,
        insurerId: policy.insurerId,
        claimType: ["Cristales", "Gastos medicos", "Daños a terceros", "Robo parcial"][index],
        description: "Siniestro demo para roadmap Fase 6.",
        status: ["OPEN", "IN_PROGRESS", "WAITING_INSURER", "RESOLVED"][index] as never,
        incidentDate: subDays(baseDate, 20 + index),
        reportedDate: subDays(baseDate, 18 + index),
        closedDate: index === 3 ? subDays(baseDate, 2) : null,
        amountClaimed: 15000 + index * 12000,
        amountPaid: index === 3 ? 22000 : null,
        ...audit,
      },
    });
  }

  for (let index = 0; index < 6; index += 1) {
    const client = clients[index + 3];
    await prisma.quote.create({
      data: {
        clientId: client.id,
        insurerId: index % 2 === 0 ? insurers[index % insurers.length].id : null,
        policyType: policyTypes[(index + 4) % policyTypes.length],
        status: ["REQUESTED", "IN_PROGRESS", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"][index] as never,
        requestedDate: subDays(baseDate, 12 + index),
        sentDate: index >= 2 ? subDays(baseDate, 5 + index) : null,
        validUntil: addDays(baseDate, [3, 7, -2, 15, 21, -5][index]),
        quotedAmount: 9800 + index * 2400,
        notes: "Cotizacion demo para seguimiento comercial.",
        ...audit,
      },
    });
  }

  const alerts = [
    ["RECEIPT_OVERDUE", "CRITICAL", "Recibo vencido sin seguimiento"],
    ["POLICY_MISSING_PDF", "WARNING", "Poliza activa sin PDF"],
    ["COMMISSION_OVERDUE", "WARNING", "Comision vencida por cobrar"],
    ["CLIENT_MISSING_CONTACT", "WARNING", "Cliente incompleto"],
    ["RENEWAL_WITHOUT_TASK", "WARNING", "Renovacion sin pendiente"],
    ["POLICY_EXPIRED", "CRITICAL", "Poliza vencida"],
    ["ORPHAN_DOCUMENT", "INFO", "Documento huerfano"],
    ["DUPLICATE_POLICY_NUMBER", "WARNING", "Poliza duplicada"],
    ["STALE_TASK", "WARNING", "Pendiente antiguo"],
    ["PAID_RECEIPT_WITHOUT_PROOF", "WARNING", "Pago sin comprobante"],
  ] as const;

  for (let index = 0; index < alerts.length; index += 1) {
    const [alertType, severity, title] = alerts[index];
    const policy = policies[index % policies.length];
    await prisma.alert.create({
      data: {
        alertType,
        severity,
        title,
        description: "Alerta demo generada para mostrar riesgos operativos.",
        entityType: index % 2 === 0 ? "Policy" : "Receipt",
        entityId: index % 2 === 0 ? policy.id : receipts[index].id,
        status: "OPEN",
      },
    });
  }

  const actions = [
    "Cliente creado",
    "Poliza creada",
    "Recibo creado",
    "Recibo marcado como pagado",
    "Pendiente creado",
    "Pendiente cerrado",
    "Documento cargado",
    "Comision marcada como cobrada",
    "Renovacion actualizada",
    "Alerta resuelta",
  ];

  for (let index = 0; index < 40; index += 1) {
    const policy = policies[index % policies.length];
    await prisma.activityLog.create({
      data: {
        entityType: index % 3 === 0 ? "Client" : index % 3 === 1 ? "Policy" : "Receipt",
        entityId: index % 3 === 0 ? policy.clientId : index % 3 === 1 ? policy.id : receipts[index % receipts.length].id,
        action: actions[index % actions.length],
        oldValue: index % 5 === 0 ? "Pendiente" : null,
        newValue: index % 5 === 0 ? "Actualizado" : null,
        createdAt: subDays(baseDate, index),
        userId: index % 2 === 0 ? adminUser.id : brokerUser.id,
      },
    });
  }

  console.log("Seed completo: 12 clientes, 6 aseguradoras, 25 polizas, 50 recibos, 20 pagos, 25 comisiones, 30 pendientes, 12 documentos, 10 alertas y 40 logs.");
}

async function resetDatabase() {
  await prisma.receipt.updateMany({ data: { documentId: null } });
  await prisma.alert.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.commission.deleteMany();
  await prisma.document.deleteMany();
  await prisma.task.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.client.deleteMany();
  await prisma.insurer.deleteMany();
  await prisma.user.deleteMany();
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "");
}

function insuredObjectFor(policyType: (typeof policyTypes)[number], index: number) {
  const values: Record<(typeof policyTypes)[number], string> = {
    AUTO: `Tesla Model 3 ${2020 + (index % 5)}`,
    GMM: "Cobertura familiar nacional",
    VIDA: "Suma asegurada individual",
    DANOS: "Bodega y contenidos",
    FIANZAS: "Contrato de obra publica",
    HOGAR: "Casa habitacion",
    RESPONSABILIDAD_CIVIL: "Responsabilidad civil profesional",
    EMPRESARIAL: "Paquete empresarial",
    ACCIDENTES: "Accidentes personales colectivo",
    OTRO: "Cobertura especial",
  };

  return values[policyType];
}

function taskTitle(index: number) {
  const titles = [
    "Confirmar pago con cliente",
    "Solicitar PDF de poliza",
    "Preparar renovacion",
    "Validar comision pendiente",
    "Enviar cotizacion actualizada",
    "Dar seguimiento a aseguradora",
    "Completar datos de contacto",
    "Cargar comprobante de pago",
  ];

  return titles[index % titles.length];
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
