#!/usr/bin/env tsx

import { getDb } from '../src/lib/db';
import fs from 'fs';

interface SapsRecord {
  "No. de Póliza": string;
  "No. Recibo": string;
  "Ini Vigencia Rec": string;
  "Fin Vigencia Rec": string;
  "No. de Endoso": string;
  "Tipo Endoso": string;
  "Concepto Endoso": string;
  "Tipo Póliza": string;
  Cliente: string;
  Descripción: string;
  Modelo: string;
  Serie: string;
  Inciso: string;
  Subramo: string;
  "Tipo Servicio": string;
  Producto: string;
  "Clave Compañía": string;
  Compañía: string;
  Vendedor: string;
  "Inicio Vigencia Póliza": string;
  "Fin Vigencia": string;
  "Inicio Vigencia Endoso": string;
  "Fin Vigencia Endoso": string;
  "Frecuencia Pago": string;
  Pagado: string;
  "Fecha aplicación": string;
  Moneda: string;
  "Prima Neta Recibo": string;
  "Prima Total Recibo": string;
  Estatus: string;
}

function normalizePolicyNumber(num: string): string {
  return num
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-]/g, "")
    .replace(/[.]/g, "")
    .replace(/^0+/, ""); // Remove leading zeros
}

function normalizeInsurerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[,\.]/g, "")
    .replace(/S\.A\.DE\.C\.V\./g, "SA")
    .replace(/S\.A\.DE\.C\.V/g, "SA")
    .replace(/GRUPO FINANCIERO/g, "")
    .trim();
}

function normalizeClientName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[,\.]/g, "")
    .replace(/S\.A\.P\.I\.DE\.C\.V\./g, "SA")
    .replace(/S\.A\.DE\.C\.V\./g, "SA")
    .trim();
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.log("Uso: tsx scripts/compare-saps.ts <ruta-al-archivo-saps.csv>");
    process.exit(1);
  }

  console.log("Comparando datos de importación PDF con SAPS CSV");
  console.log(`CSV: ${csvPath}`);
  console.log("");

  // Read CSV file
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  
  const sapsRecords: SapsRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      const values = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g) || [];
      const record: any = {};
      headers.forEach((header, index) => {
        record[header] = values[index]?.replace(/"/g, '').trim() || '';
      });
      sapsRecords.push(record as SapsRecord);
    }
  }

  console.log(`Registros SAPS: ${sapsRecords.length}`);

  // Group SAPS records by policy number
  const sapsByPolicy = new Map<string, SapsRecord[]>();
  for (const record of sapsRecords) {
    const policyNum = normalizePolicyNumber(record["No. de Póliza"]);
    if (!sapsByPolicy.has(policyNum)) {
      sapsByPolicy.set(policyNum, []);
    }
    sapsByPolicy.get(policyNum)!.push(record);
  }

  // Get database data
  const db = getDb();
  const policies = await db.policy.findMany({
    include: {
      client: true,
      insurer: true,
      receipts: {
        select: { id: true }
      }
    }
  });

  // Group database policies by normalized policy number
  const dbByPolicy = new Map<string, typeof policies[0]>();
  for (const policy of policies) {
    const normNum = normalizePolicyNumber(policy.policyNumber);
    dbByPolicy.set(normNum, policy);
  }

  // Compare
  const matches: string[] = [];
  const mismatches: string[] = [];
  const sapsOnly: string[] = [];
  const dbOnly: string[] = [];

  // Check SAPS policies
  for (const [sapsNormNum, sapsRecs] of sapsByPolicy.entries()) {
    const dbPolicy = dbByPolicy.get(sapsNormNum);
    
    if (!dbPolicy) {
      sapsOnly.push(`${sapsNormNum} (${sapsRecs[0].Compañía} - ${sapsRecs[0].Cliente})`);
      continue;
    }

    // Compare insurer
    const sapsInsurer = normalizeInsurerName(sapsRecs[0].Compañía);
    const dbInsurer = normalizeInsurerName(dbPolicy.insurer?.name || '');
    
    // Compare client
    const sapsClient = normalizeClientName(sapsRecs[0].Cliente);
    const dbClient = normalizeClientName(dbPolicy.client?.fullName || '');

    const insurerMatch = sapsInsurer === dbInsurer || 
                        sapsInsurer.includes(dbInsurer) || 
                        dbInsurer.includes(sapsInsurer);
    
    const clientMatch = sapsClient === dbClient || 
                       sapsClient.includes(dbClient) || 
                       dbClient.includes(sapsClient);

    if (insurerMatch && clientMatch) {
      matches.push(`${dbPolicy.policyNumber}: ${dbPolicy.insurer?.name} - ${dbPolicy.client?.fullName} (${dbPolicy.receipts.length} recibos)`);
    } else {
      mismatches.push(`${dbPolicy.policyNumber}: SAPS[${sapsRecs[0].Compañía} - ${sapsRecs[0].Cliente}] vs DB[${dbPolicy.insurer?.name} - ${dbPolicy.client?.fullName}]`);
    }
  }

  // Check database-only policies
  for (const [dbNormNum, dbPolicy] of dbByPolicy.entries()) {
    if (!sapsByPolicy.has(dbNormNum)) {
      dbOnly.push(`${dbPolicy.policyNumber}: ${dbPolicy.insurer?.name} - ${dbPolicy.client?.fullName}`);
    }
  }

  // Print results
  console.log("\n" + "=".repeat(80));
  console.log("RESULTADOS DE COMPARACIÓN");
  console.log("=".repeat(80));

  console.log(`\n✅ Coincidencias (${matches.length}):`);
  matches.slice(0, 10).forEach(m => console.log(`  ${m}`));
  if (matches.length > 10) console.log(`  ... y ${matches.length - 10} más`);

  console.log(`\n❌ Desajustes (${mismatches.length}):`);
  mismatches.slice(0, 10).forEach(m => console.log(`  ${m}`));
  if (mismatches.length > 10) console.log(`  ... y ${mismatches.length - 10} más`);

  console.log(`\n📋 Solo en SAPS (${sapsOnly.length}):`);
  sapsOnly.slice(0, 10).forEach(m => console.log(`  ${m}`));
  if (sapsOnly.length > 10) console.log(`  ... y ${sapsOnly.length - 10} más`);

  console.log(`\n💾 Solo en BD (${dbOnly.length}):`);
  dbOnly.slice(0, 10).forEach(m => console.log(`  ${m}`));
  if (dbOnly.length > 10) console.log(`  ... y ${dbOnly.length - 10} más`);

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("RESUMEN");
  console.log("=".repeat(80));
  console.log(`Total SAPS: ${sapsByPolicy.size}`);
  console.log(`Total BD: ${dbByPolicy.size}`);
  console.log(`Coincidencias: ${matches.length} (${((matches.length / Math.max(sapsByPolicy.size, dbByPolicy.size)) * 100).toFixed(1)}%)`);
  console.log(`Desajustes: ${mismatches.length}`);
  console.log(`Solo SAPS: ${sapsOnly.length}`);
  console.log(`Solo BD: ${dbOnly.length}`);
}

main().catch(console.error);
