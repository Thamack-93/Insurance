import { z } from "zod";

import {
  backupDatabase,
  closeDb,
  createDb,
  formatDateShort,
  getFlag,
  normalizeKey,
  parseCliArgs,
  pickValue,
  printTable,
  readTabularInput,
  safeJson,
  toDateValue,
  toEnumValue,
  toNumberValue,
  toNumber,
  toStringValue,
} from "./_shared.ts";

const policySchema = z.object({
  policyNumber: z.string().min(2),
  clientRef: z.string().min(1),
  insurerRef: z.string().min(1),
  policyType: z.enum([
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
  ]),
  status: z.enum(["ACTIVE", "EXPIRED", "CANCELLED", "RENEWED", "PENDING"]).default("ACTIVE"),
  startDate: z.date(),
  endDate: z.date(),
  premiumAmount: z.number().positive(),
  currency: z.string().min(3).max(3).default("MXN"),
  paymentFrequency: z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "SINGLE", "OTHER"]),
  paymentPlan: z.string().optional(),
  insuredObject: z.string().optional(),
  beneficiaryInfo: z.string().optional(),
  notes: z.string().optional(),
});

type PolicyInput = z.infer<typeof policySchema>;

type ExistingPolicy = {
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
  client?: { id: string; fullName: string };
  insurer?: { id: string; name: string };
};

type ClientRef = { id: string; fullName: string; email: string | null; rfc: string | null };
type InsurerRef = { id: string; name: string; contactEmail: string | null };

function textValue(value: unknown) {
  return toStringValue(value);
}

function buildPolicyInput(row: Record<string, unknown>) {
  return policySchema.parse({
    policyNumber: textValue(pickValue(row, ["policyNumber", "numeroPoliza", "poliza"])) ?? "",
    clientRef:
      textValue(pickValue(row, ["clientId", "clienteId", "client", "cliente", "clientName", "clienteNombre"])) ?? "",
    insurerRef:
      textValue(
        pickValue(row, ["insurerId", "aseguradoraId", "insurer", "aseguradora", "insurerName", "aseguradoraNombre"]),
      ) ?? "",
    policyType: toEnumValue(
      pickValue(row, ["policyType", "tipoPoliza", "tipo"]),
      [
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
      ],
    ) ?? "OTRO",
    status: toEnumValue(pickValue(row, ["status", "estado"]), ["ACTIVE", "EXPIRED", "CANCELLED", "RENEWED", "PENDING"]) ?? "ACTIVE",
    startDate: toDateValue(pickValue(row, ["startDate", "fechaInicio", "inicio"])) ?? new Date("invalid"),
    endDate: toDateValue(pickValue(row, ["endDate", "fechaFin", "fin"])) ?? new Date("invalid"),
    premiumAmount: toNumberValue(pickValue(row, ["premiumAmount", "prima", "montoPrima"])) ?? Number.NaN,
    currency: (textValue(pickValue(row, ["currency", "moneda"])) ?? "MXN").toUpperCase(),
    paymentFrequency: toEnumValue(
      pickValue(row, ["paymentFrequency", "frecuenciaPago"]),
      ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "SINGLE", "OTHER"],
    ) ?? "OTHER",
    paymentPlan: textValue(pickValue(row, ["paymentPlan", "planPago"])),
    insuredObject: textValue(pickValue(row, ["insuredObject", "objetoAsegurado"])),
    beneficiaryInfo: textValue(pickValue(row, ["beneficiaryInfo", "beneficiarios"])),
    notes: textValue(pickValue(row, ["notes", "notas", "comentarios"])),
  });
}

function normalizeComparable(value: unknown) {
  return normalizeKey(String(value ?? ""));
}

function sameDate(left: Date | string, right: Date | string) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function resolveSingle<T>(items: T[], label: string) {
  if (items.length > 1) {
    throw new Error(`Coincidencia ambigua para ${label}.`);
  }

  return items[0] ?? null;
}

function resolveClient(clientRefs: ClientRef[], ref: string) {
  const target = normalizeComparable(ref);
  const matches = clientRefs.filter((client) =>
    [client.id, client.fullName, client.email, client.rfc].some((value) => value && normalizeComparable(value) === target),
  );
  return resolveSingle(matches, `el cliente "${ref}"`);
}

function resolveInsurer(insurerRefs: InsurerRef[], ref: string) {
  const target = normalizeComparable(ref);
  const matches = insurerRefs.filter((insurer) =>
    [insurer.id, insurer.name, insurer.contactEmail].some((value) => value && normalizeComparable(value) === target),
  );
  return resolveSingle(matches, `la aseguradora "${ref}"`);
}

function resolvePolicyMatch(policies: ExistingPolicy[], input: PolicyInput) {
  const target = normalizeComparable(input.policyNumber);
  const matches = policies.filter(
    (policy) =>
      normalizeComparable(policy.policyNumber) === target &&
      sameDate(policy.startDate, input.startDate) &&
      sameDate(policy.endDate, input.endDate),
  );
  return resolveSingle(matches, `la vigencia "${input.policyNumber}"`);
}

function resolvePolicyFamilyRootId(policies: ExistingPolicy[], input: PolicyInput, client: ClientRef, insurer: InsurerRef) {
  const target = normalizeComparable(input.policyNumber);
  const matches = policies
    .filter((policy) => normalizeComparable(policy.policyNumber) === target)
    .filter((policy) => policy.clientId === client.id && policy.insurerId === insurer.id)
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

  const root = matches[0];
  return root ? root.familyRootId ?? root.id : null;
}

function buildUpdateData(
  existing: ExistingPolicy,
  input: PolicyInput,
  client: ClientRef,
  insurer: InsurerRef,
) {
  const data: Record<string, unknown> = {};
  const nextClientId = client.id;
  const nextInsurerId = insurer.id;

  const comparableEntries: Array<[keyof PolicyInput, keyof ExistingPolicy | string, unknown]> = [
    ["clientRef", "clientId", nextClientId],
    ["insurerRef", "insurerId", nextInsurerId],
    ["policyType", "policyType", input.policyType],
    ["status", "status", input.status],
    ["startDate", "startDate", input.startDate],
    ["endDate", "endDate", input.endDate],
    ["premiumAmount", "premiumAmount", input.premiumAmount],
    ["currency", "currency", input.currency],
    ["paymentFrequency", "paymentFrequency", input.paymentFrequency],
    ["paymentPlan", "paymentPlan", input.paymentPlan ?? null],
    ["insuredObject", "insuredObject", input.insuredObject ?? null],
    ["beneficiaryInfo", "beneficiaryInfo", input.beneficiaryInfo ?? null],
    ["notes", "notes", input.notes ?? null],
  ];

  for (const [inputKey, existingKey, next] of comparableEntries) {
    const current = existing[existingKey as keyof ExistingPolicy];
    const same =
      inputKey === "premiumAmount"
        ? toNumber(current) === toNumber(next)
        : current instanceof Date || next instanceof Date
          ? String(new Date(current as Date | string).getTime()) === String(new Date(next as Date | string).getTime())
          : normalizeComparable(current) === normalizeComparable(next);
    if (same) continue;

    if (inputKey === "clientRef") {
      data.clientId = next;
    } else if (inputKey === "insurerRef") {
      data.insurerId = next;
    } else {
      data[inputKey] = next;
    }
  }

  return data;
}

async function main() {
  const args = parseCliArgs();
  const dryRun = Boolean(args.flags["dry-run"] || args.flags["dryRun"]);
  const inputPath = getFlag(args, "file") ?? args.positionals[0];

  if (!inputPath) {
    throw new Error("Debes indicar un archivo con --file o como primer argumento.");
  }

  const rows = await readTabularInput(inputPath);
  const db = createDb();

  const [policies, clientRefs, insurerRefs] = await Promise.all([
    db.policy.findMany({
      select: {
        id: true,
        policyNumber: true,
        familyRootId: true,
        clientId: true,
        insurerId: true,
        policyType: true,
        status: true,
        startDate: true,
        endDate: true,
        premiumAmount: true,
        currency: true,
        paymentFrequency: true,
        paymentPlan: true,
        insuredObject: true,
        beneficiaryInfo: true,
        notes: true,
        client: { select: { id: true, fullName: true } },
        insurer: { select: { id: true, name: true } },
      },
    }),
    db.client.findMany({
      select: { id: true, fullName: true, email: true, rfc: true },
    }),
    db.insurer.findMany({
      select: { id: true, name: true, contactEmail: true },
    }),
  ]);

  const operations: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    try {
      const input = buildPolicyInput(row);
      const client = resolveClient(clientRefs, input.clientRef);
      const insurer = resolveInsurer(insurerRefs, input.insurerRef);

      if (!client) {
        throw new Error(`No se encontro el cliente "${input.clientRef}".`);
      }
      if (!insurer) {
        throw new Error(`No se encontro la aseguradora "${input.insurerRef}".`);
      }

      const match = resolvePolicyMatch(policies, input);

      if (!match) {
        const familyRootId = resolvePolicyFamilyRootId(policies, input, client, insurer);
        if (!dryRun) {
          await db.policy.create({
            data: {
              policyNumber: input.policyNumber,
              familyRootId,
              clientId: client.id,
              insurerId: insurer.id,
              policyType: input.policyType,
              status: input.status,
              startDate: input.startDate,
              endDate: input.endDate,
              premiumAmount: input.premiumAmount,
              currency: input.currency,
              paymentFrequency: input.paymentFrequency,
              paymentPlan: input.paymentPlan,
              insuredObject: input.insuredObject,
              beneficiaryInfo: input.beneficiaryInfo,
              notes: input.notes,
            },
          });
        }
        created += 1;
        operations.push({
          Fila: index + 2,
          Accion: "CREAR",
          Poliza: input.policyNumber,
          Cliente: client.fullName,
          Aseguradora: insurer.name,
          Vencimiento: formatDateShort(input.endDate),
        });
        continue;
      }

      const data = buildUpdateData(match, input, client, insurer);
      if (!Object.keys(data).length) {
        skipped += 1;
        operations.push({
          Fila: index + 2,
          Accion: "SIN_CAMBIOS",
          Poliza: match.policyNumber,
          Cliente: match.client?.fullName ?? client.fullName,
          Aseguradora: match.insurer?.name ?? insurer.name,
          Vencimiento: formatDateShort(match.endDate),
        });
        continue;
      }

      if (!dryRun) {
        await db.policy.update({
          where: { id: match.id },
          data,
        });
      }

      updated += 1;
      operations.push({
        Fila: index + 2,
        Accion: "ACTUALIZAR",
        Poliza: input.policyNumber,
        Cliente: client.fullName,
        Aseguradora: insurer.name,
        Vencimiento: formatDateShort(input.endDate),
      });
    } catch (error) {
      errors.push(`Fila ${index + 2}: ${(error as Error).message}`);
    }
  }

  console.log("Importacion de polizas");
  console.log(`Archivo: ${inputPath}`);
  console.log(`Filas leidas: ${rows.length}`);
  console.log(`Nuevas: ${created}`);
  console.log(`Actualizadas: ${updated}`);
  console.log(`Sin cambios: ${skipped}`);
  console.log(`Errores: ${errors.length}`);

  if (errors.length) {
    console.log("");
    console.log("Errores detectados:");
    for (const error of errors.slice(0, 10)) {
      console.log(`- ${error}`);
    }
  }

  printTable(dryRun ? "Vista previa" : "Cambios detectados", operations.slice(0, 20));

  if (dryRun || (!created && !updated)) {
    await closeDb(db);
    if (errors.length) process.exitCode = 1;
    return;
  }

  const backup = await backupDatabase();
  if (backup) {
    console.log("");
    console.log(`Backup previo creado: ${backup}`);
  }

  for (const [index, row] of rows.entries()) {
    try {
      const input = buildPolicyInput(row);
      const client = resolveClient(clientRefs, input.clientRef);
      const insurer = resolveInsurer(insurerRefs, input.insurerRef);
      if (!client) throw new Error(`No se encontro el cliente "${input.clientRef}".`);
      if (!insurer) throw new Error(`No se encontro la aseguradora "${input.insurerRef}".`);

      const exactMatch = resolvePolicyMatch(policies, input);

      if (!exactMatch) {
        const familyRootId = resolvePolicyFamilyRootId(policies, input, client, insurer);
        const createdPolicy = await db.policy.create({
          data: {
            policyNumber: input.policyNumber,
            familyRootId,
            clientId: client.id,
            insurerId: insurer.id,
            policyType: input.policyType,
            status: input.status,
            startDate: input.startDate,
            endDate: input.endDate,
            premiumAmount: input.premiumAmount,
            currency: input.currency,
            paymentFrequency: input.paymentFrequency,
            paymentPlan: input.paymentPlan,
            insuredObject: input.insuredObject,
            beneficiaryInfo: input.beneficiaryInfo,
            notes: input.notes,
          },
          include: {
            client: { select: { id: true, fullName: true } },
            insurer: { select: { id: true, name: true } },
          },
        });

        policies.push(createdPolicy);

        await db.activityLog.create({
          data: {
            entityType: "Policy",
            entityId: createdPolicy.id,
            action: "IMPORT_CREATE",
            oldValue: null,
            newValue: safeJson(createdPolicy),
            userId: "system-user-0000",
          },
        });

        continue;
      }

      const data = buildUpdateData(exactMatch, input, client, insurer);
      if (!Object.keys(data).length) continue;

      const previousPolicy = { ...exactMatch };

      const updatedPolicy = await db.policy.update({
        where: { id: exactMatch.id },
        data,
        include: {
          client: { select: { id: true, fullName: true } },
          insurer: { select: { id: true, name: true } },
        },
      });

      Object.assign(exactMatch, {
        clientId: updatedPolicy.clientId,
        insurerId: updatedPolicy.insurerId,
        policyType: updatedPolicy.policyType,
        status: updatedPolicy.status,
        startDate: updatedPolicy.startDate,
        endDate: updatedPolicy.endDate,
        premiumAmount: updatedPolicy.premiumAmount,
        currency: updatedPolicy.currency,
        paymentFrequency: updatedPolicy.paymentFrequency,
        paymentPlan: updatedPolicy.paymentPlan,
        insuredObject: updatedPolicy.insuredObject,
        beneficiaryInfo: updatedPolicy.beneficiaryInfo,
        notes: updatedPolicy.notes,
        client: updatedPolicy.client,
        insurer: updatedPolicy.insurer,
      });

      await db.activityLog.create({
        data: {
          entityType: "Policy",
          entityId: updatedPolicy.id,
          action: "IMPORT_UPDATE",
          oldValue: safeJson(previousPolicy),
          newValue: safeJson(updatedPolicy),
          userId: "system-user-0000",
        },
      });
    } catch (error) {
      console.error(`Fila ${index + 2}: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }

  console.log("");
  console.log("Importacion completada.");
  console.log(`Se procesaron ${rows.length} filas.`);
  console.log(`Polizas creadas: ${created}`);
  console.log(`Polizas actualizadas: ${updated}`);
  console.log(`Polizas sin cambios: ${skipped}`);
  if (dryRun) console.log("Modo simulacion activado: no se escribio nada.");

  if (errors.length) process.exitCode = 1;

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al importar polizas.");
  console.error(error);
  process.exit(1);
});
