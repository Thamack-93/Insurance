#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { getDb } from '../src/lib/db';

interface SapsRecord {
  policyNumber: string;
  receiptNumber: string;
  clientName: string;
  insurerName: string;
  vehicleDesc: string;
  serie: string;
  startDate: string;
  endDate: string;
  paymentFrequency: string;
  status: string;
}

function parseSapsCsv(csvPath: string): SapsRecord[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  
  if (lines.length < 2) return [];
  
  const records: SapsRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 10) continue;
    
    records.push({
      policyNumber: parts[0]?.replace(/\s/g, '') || '',
      receiptNumber: parts[1] || '',
      clientName: parts[8] || '',
      insurerName: parts[17] || '',
      vehicleDesc: parts[9] || '',
      serie: parts[11]?.replace(/\s/g, '') || '',
      startDate: parts[19] || '',
      endDate: parts[20] || '',
      paymentFrequency: parts[23] || '',
      status: parts[29] || '',
    });
  }
  
  return records;
}

async function scanPdfs(basePath: string): Promise<Array<{ filePath: string; text: string; folderName: string }>> {
  const results: Array<{ filePath: string; text: string; folderName: string }> = [];
  
  async function scanDir(dir: string, folderName: string) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath, entry.name);
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        try {
          const buffer = await fs.promises.readFile(fullPath);
          const parser = new PDFParse({ data: buffer });
          const textResult = await parser.getText();
          results.push({ filePath: fullPath, text: textResult.text, folderName });
        } catch {
          // Skip failed PDFs
        }
      }
    }
  }
  
  await scanDir(basePath, path.basename(basePath));
  return results;
}

function normalizePolicyNumber(num: string): string {
  // Remove spaces, dashes, dots AND leading zeros
  return num.toUpperCase().replace(/\s+/g, '').replace(/[-.]/g, '').replace(/^0+/, '');
}

function findBestMatchingPdf(
  sapsRecord: SapsRecord, 
  pdfs: Array<{ filePath: string; text: string; folderName: string }>
): { filePath: string; confidence: number } | null {
  const normPolicy = normalizePolicyNumber(sapsRecord.policyNumber);
  const clientName = sapsRecord.clientName.toUpperCase();
  
  let bestMatch: { filePath: string; confidence: number } | null = null;
  let bestScore = 0;
  
  for (const pdf of pdfs) {
    let score = 0;
    const normText = normalizePolicyNumber(pdf.text);
    const upperText = pdf.text.toUpperCase();
    
    // Exact policy number match
    if (normText.includes(normPolicy)) {
      score += 100;
    }
    // Partial match (last 7 digits)
    else if (normText.includes(normPolicy.slice(-7))) {
      score += 50;
    }
    
    // Client name match
    if (upperText.includes(clientName)) {
      score += 30;
    }
    // Partial client name
    else if (clientName.split(' ').some(part => part.length > 3 && upperText.includes(part))) {
      score += 15;
    }
    
    // Insurer match
    const insurer = sapsRecord.insurerName.toUpperCase();
    if (upperText.includes(insurer) || 
        (insurer.includes('BANORTE') && upperText.includes('BANORTE')) ||
        (insurer.includes('QUÁLITAS') && upperText.includes('QUÁLITAS')) ||
        (insurer.includes('QUALITAS') && upperText.includes('QUALITAS'))) {
      score += 20;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { filePath: pdf.filePath, confidence: score };
    }
  }
  
  return bestMatch && bestScore >= 50 ? bestMatch : null;
}

function parseDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const year = parseInt(parts[2]);
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) return date;
  }
  return undefined;
}

function mapInsurerName(sapsName: string): string {
  const name = sapsName.toUpperCase();
  if (name.includes('BANORTE')) return 'Banorte Seguros';
  if (name.includes('QUÁLITAS') || name.includes('QUALITAS')) return 'Qualitas Compañía de Seguros';
  if (name.includes('MAPFRE')) return 'Mapfre México';
  if (name.includes('ZURICH')) return 'Zurich Seguros';
  if (name.includes('CHUBB')) return 'Chubb Seguros México';
  if (name.includes('AXA')) return 'AXA Seguros';
  if (name.includes('GNP')) return 'GNP Seguros';
  return sapsName;
}

function mapPaymentFrequency(freq: string): string {
  const upper = freq.toUpperCase();
  if (upper.includes('MENSUAL')) return 'MONTHLY';
  if (upper.includes('TRIMESTRAL')) return 'QUARTERLY';
  if (upper.includes('SEMESTRAL')) return 'SEMIANNUAL';
  if (upper.includes('ANUAL')) return 'ANNUAL';
  return 'ANNUAL';
}

async function main() {
  const sapsPath = process.argv[2];
  const pdfBasePath = process.argv[3];
  const dryRun = process.argv.includes('--dry-run');
  
  if (!sapsPath || !pdfBasePath) {
    console.log('Uso: tsx scripts/import-from-saps.ts <saps-csv> <pdf-folder> [--dry-run]');
    process.exit(1);
  }
  
  console.log('Importando desde SAPS...');
  console.log(`Modo simulación: ${dryRun ? 'SÍ' : 'NO'}`);
  console.log('');
  
  // Load SAPS data
  const sapsRecords = parseSapsCsv(sapsPath);
  console.log(`Registros SAPS: ${sapsRecords.length}`);
  
  // Get unique policies
  const sapsPolicies = new Map<string, SapsRecord>();
  for (const record of sapsRecords) {
    if (!sapsPolicies.has(record.policyNumber)) {
      sapsPolicies.set(record.policyNumber, record);
    }
  }
  console.log(`Pólizas únicas: ${sapsPolicies.size}`);
  console.log('');
  
  // Scan PDFs
  console.log('Escaneando PDFs...');
  const pdfs = await scanPdfs(pdfBasePath);
  console.log(`PDFs escaneados: ${pdfs.length}`);
  console.log('');
  
  // Match and prepare import
  const toImport: Array<{
    record: SapsRecord;
    pdfPath: string;
  }> = [];
  
  const notFound: string[] = [];
  
  for (const [policyNum, record] of sapsPolicies) {
    const match = findBestMatchingPdf(record, pdfs);
    if (match) {
      toImport.push({ record, pdfPath: match.filePath });
    } else {
      notFound.push(policyNum);
    }
  }
  
  console.log('=' .repeat(80));
  console.log('RESULTADOS PREVIOS A IMPORTACIÓN');
  console.log('=' .repeat(80));
  console.log(`✅ Listas para importar: ${toImport.length}`);
  console.log(`❌ No encontradas: ${notFound.length}`);
  console.log('');
  
  if (toImport.length === 0) {
    console.log('No hay pólizas para importar.');
    return;
  }
  
  // Preview
  console.log('Vista previa (primeras 10):');
  toImport.slice(0, 10).forEach(item => {
    console.log(`  ${item.record.policyNumber} | ${item.record.clientName.substring(0, 25).padEnd(25)} | ${path.basename(item.pdfPath).substring(0, 40)}`);
  });
  console.log('');
  
  if (dryRun) {
    console.log('Modo simulación - no se realizaron cambios.');
    return;
  }
  
  // Proceed with import
  console.log('Procediendo con importación...');
  const db = getDb();
  
  let created = 0;
  let updated = 0;
  let errors = 0;
  
  for (const item of toImport) {
    try {
      const { record, pdfPath } = item;
      
      // Resolve or create client
      const clientName = record.clientName;
      let client = await db.client.findFirst({
        where: { fullName: { contains: clientName } }
      });
      
      if (!client) {
        client = await db.client.create({
          data: {
            fullName: clientName,
            type: clientName.includes('SA') || clientName.includes('S.A.') ? 'COMPANY' : 'PERSON',
            status: 'ACTIVE',
          }
        });
      }
      
      // Resolve or create insurer
      const insurerName = mapInsurerName(record.insurerName);
      let insurer = await db.insurer.findFirst({
        where: { name: { contains: insurerName } }
      });
      
      if (!insurer) {
        insurer = await db.insurer.create({
          data: {
            name: insurerName,
            status: 'ACTIVE',
          }
        });
      }
      
      // Check if policy exists
      const existingPolicy = await db.policy.findFirst({
        where: { policyNumber: record.policyNumber }
      });
      
      const startDate = parseDate(record.startDate);
      const endDate = parseDate(record.endDate);
      
      let policy;
      if (existingPolicy) {
        policy = await db.policy.update({
          where: { id: existingPolicy.id },
          data: {
            clientId: client.id,
            insurerId: insurer.id,
            startDate: startDate || existingPolicy.startDate,
            endDate: endDate || existingPolicy.endDate,
            status: record.status === 'CANCELADO' ? 'CANCELLED' : 'ACTIVE',
          }
        });
        updated++;
      } else {
        policy = await db.policy.create({
          data: {
            policyNumber: record.policyNumber,
            clientId: client.id,
            insurerId: insurer.id,
            policyType: 'AUTO',
            startDate: startDate || new Date(),
            endDate: endDate || new Date(),
            status: record.status === 'CANCELADO' ? 'CANCELLED' : 'ACTIVE',
            premiumAmount: 0,
            paymentFrequency: mapPaymentFrequency(record.paymentFrequency) as any,
          }
        });
        created++;
      }
      
      // Create document record
      await db.document.create({
        data: {
          policyId: policy.id,
          clientId: client.id,
          documentType: 'POLICY',
          fileName: path.basename(pdfPath),
          filePath: pdfPath,
          mimeType: 'application/pdf',
        }
      });
      
      console.log(`  ${record.policyNumber}: ${existingPolicy ? 'Actualizada' : 'Creada'}`);
      
    } catch (error) {
      console.error(`  Error en ${item.record.policyNumber}:`, error);
      errors++;
    }
  }
  
  console.log('');
  console.log('=' .repeat(80));
  console.log('RESUMEN DE IMPORTACIÓN');
  console.log('=' .repeat(80));
  console.log(`Pólizas creadas: ${created}`);
  console.log(`Pólizas actualizadas: ${updated}`);
  console.log(`Errores: ${errors}`);
  console.log('=' .repeat(80));
}

main().catch(console.error);
