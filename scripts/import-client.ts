import { z } from "zod";

import {
  backupDatabase,
  closeDb,
  createDb,
  getFlag,
  normalizeKey,
  parseCliArgs,
  pickValue,
  printTable,
  readTabularInput,
  safeJson,
  toEnumValue,
  toStringValue,
} from "./_shared";

const clientSchema = z.object({
  id: z.string().optional(),
  fullName: z.string().min(2),
  type: z.enum(["PERSON", "COMPANY"]).default("PERSON"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  secondaryPhone: z.string().optional(),
  rfc: z.string().optional(),
  address: z.string().optional(),
  preferredContactMethod: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).default("ACTIVE"),
});

type ClientInput = z.infer<typeof clientSchema>;

type ExistingClient = {
  id: string;
  fullName: string;
  email: string | null;
  rfc: string | null;
  type: string;
  phone: string | null;
  secondaryPhone: string | null;
  address: string | null;
  preferredContactMethod: string | null;
  notes: string | null;
  status: string;
};

function fieldText(value: unknown) {
  return toStringValue(value);
}

function buildClientInput(row: Record<string, unknown>) {
  return clientSchema.parse({
    id: fieldText(pickValue(row, ["id", "clientId", "clienteId"])),
    fullName: fieldText(pickValue(row, ["fullName", "nombre", "name", "cliente"])) ?? "",
    type: toEnumValue(pickValue(row, ["type", "tipo"]), ["PERSON", "COMPANY"]) ?? "PERSON",
    email: fieldText(pickValue(row, ["email", "correo", "correoElectronico"])),
    phone: fieldText(pickValue(row, ["phone", "telefono", "tel", "mobile"])),
    secondaryPhone: fieldText(pickValue(row, ["secondaryPhone", "telefonoSecundario", "phone2"])),
    rfc: fieldText(pickValue(row, ["rfc", "taxId"])),
    address: fieldText(pickValue(row, ["address", "direccion", "domicilio"])),
    preferredContactMethod: fieldText(
      pickValue(row, ["preferredContactMethod", "preferredContact", "metodoContacto"]),
    ),
    notes: fieldText(pickValue(row, ["notes", "notas", "comentarios"])),
    status: toEnumValue(pickValue(row, ["status", "estado"]), ["ACTIVE", "INACTIVE", "ARCHIVED"]) ?? "ACTIVE",
  });
}

function isSameText(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").trim() === (right ?? "").trim();
}

function resolveMatch(existingClients: ExistingClient[], input: ClientInput) {
  const candidates = [input.id, input.email, input.rfc, input.fullName].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    const matches = existingClients.filter((client) =>
      [client.id, client.fullName, client.email, client.rfc].some(
        (value) => value && normalizeKey(String(value)) === target,
      ),
    );

    if (matches.length > 1) {
      throw new Error(`Coincidencia ambigua para el cliente "${candidate}".`);
    }

    if (matches.length === 1) {
      return matches[0];
    }
  }

  return null;
}

function buildUpdateData(existing: ExistingClient, input: ClientInput) {
  const data: Record<string, unknown> = {};

  for (const key of [
    "fullName",
    "type",
    "email",
    "phone",
    "secondaryPhone",
    "rfc",
    "address",
    "preferredContactMethod",
    "notes",
    "status",
  ] as const) {
    const next = input[key];
    if (next === undefined) continue;

    const current = existing[key] as string | null;
    if (isSameText(current, String(next))) continue;
    data[key] = next;
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
  const existingClients = await db.client.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      rfc: true,
      type: true,
      phone: true,
      secondaryPhone: true,
      address: true,
      preferredContactMethod: true,
      notes: true,
      status: true,
    },
  });

  const operations: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    try {
      const input = buildClientInput(row);
      const match = resolveMatch(existingClients, input);

      if (!match) {
        created += 1;
        operations.push({
          Fila: index + 2,
          Accion: "CREAR",
          Cliente: input.fullName,
          Estado: input.status,
          Contacto: input.email ?? input.phone ?? "-",
        });
        continue;
      }

      const data = buildUpdateData(match, input);
      if (!Object.keys(data).length) {
        skipped += 1;
        operations.push({
          Fila: index + 2,
          Accion: "SIN_CAMBIOS",
          Cliente: match.fullName,
          Estado: match.status,
          Contacto: match.email ?? match.phone ?? "-",
        });
        continue;
      }

      updated += 1;
      operations.push({
        Fila: index + 2,
        Accion: "ACTUALIZAR",
        Cliente: input.fullName,
        Estado: input.status ?? match.status,
        Contacto: input.email ?? input.phone ?? match.email ?? match.phone ?? "-",
      });
    } catch (error) {
      errors.push(`Fila ${index + 2}: ${(error as Error).message}`);
    }
  }

  console.log("Importacion de clientes");
  console.log(`Archivo: ${inputPath}`);
  console.log(`Filas leidas: ${rows.length}`);
  console.log(`Nuevos: ${created}`);
  console.log(`Actualizados: ${updated}`);
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
      const input = buildClientInput(row);
      const match = resolveMatch(existingClients, input);

      if (!match) {
        const createdClient = await db.client.create({
          data: {
            fullName: input.fullName,
            type: input.type,
            email: input.email,
            phone: input.phone,
            secondaryPhone: input.secondaryPhone,
            rfc: input.rfc,
            address: input.address,
            preferredContactMethod: input.preferredContactMethod,
            notes: input.notes,
            status: input.status,
          },
        });

        existingClients.push({
          id: createdClient.id,
          fullName: createdClient.fullName,
          email: createdClient.email,
          rfc: createdClient.rfc,
          type: createdClient.type,
          phone: createdClient.phone,
          secondaryPhone: createdClient.secondaryPhone,
          address: createdClient.address,
          preferredContactMethod: createdClient.preferredContactMethod,
          notes: createdClient.notes,
          status: createdClient.status,
        });

        await db.activityLog.create({
          data: {
            entityType: "Client",
            entityId: createdClient.id,
            action: "IMPORT_CREATE",
            oldValue: null,
            newValue: safeJson(createdClient),
            performedBy: "scripts/import-client",
          },
        });

        continue;
      }

      const data = buildUpdateData(match, input);
      if (!Object.keys(data).length) continue;

      const previousClient = { ...match };

      const updatedClient = await db.client.update({
        where: { id: match.id },
        data,
      });

      Object.assign(match, {
        fullName: updatedClient.fullName,
        email: updatedClient.email,
        rfc: updatedClient.rfc,
        type: updatedClient.type,
        phone: updatedClient.phone,
        secondaryPhone: updatedClient.secondaryPhone,
        address: updatedClient.address,
        preferredContactMethod: updatedClient.preferredContactMethod,
        notes: updatedClient.notes,
        status: updatedClient.status,
      });

      await db.activityLog.create({
        data: {
          entityType: "Client",
          entityId: updatedClient.id,
          action: "IMPORT_UPDATE",
          oldValue: safeJson(previousClient),
          newValue: safeJson(updatedClient),
          performedBy: "scripts/import-client",
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
  console.log(`Clientes creados: ${created}`);
  console.log(`Clientes actualizados: ${updated}`);
  console.log(`Clientes sin cambios: ${skipped}`);
  if (dryRun) console.log("Modo simulacion activado: no se escribio nada.");

  if (errors.length) process.exitCode = 1;

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al importar clientes.");
  console.error(error);
  process.exit(1);
});
