#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';

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
  primaNeta: string;
  primaTotal: string;
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
    if (parts.length < 32) continue;
    
    records.push({
      policyNumber: parts[0]?.replace(/\s/g, '') || '',
      receiptNumber: parts[1] || '',
      clientName: parts[8] || '',
      insurerName: parts[18] || '',  // Column 18 is "Compañía"
      vehicleDesc: parts[9] || '',
      serie: parts[11]?.replace(/\s/g, '') || '',
      startDate: parts[20] || '',  // Column 20 is "Inicio Vigencia Póliza"
      endDate: parts[21] || '',    // Column 21 is "Fin Vigencia"
      paymentFrequency: parts[24] || '',  // Column 24 is "Frecuencia Pago"
      status: parts[30] || '',     // Column 30 is "Estatus"
      primaNeta: parts[28] || '',  // Column 28 is "Prima Neta Recibo"
      primaTotal: parts[29] || '', // Column 29 is "Prima Total Recibo"
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
        } catch (e) {
          // Skip failed PDFs
        }
      }
    }
  }
  
  await scanDir(basePath, path.basename(basePath));
  return results;
}

function normalizePolicyNumber(num: string): string {
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
  if (upper.includes('MENSUAL')) return 'Mensual';
  if (upper.includes('TRIMESTRAL')) return 'Trimestral';
  if (upper.includes('SEMESTRAL')) return 'Semestral';
  if (upper.includes('ANUAL')) return 'Anual';
  return 'Anual';
}

function mapStatus(status: string): string {
  const upper = status.toUpperCase();
  if (upper.includes('CANCELADO')) return 'Cancelado';
  if (upper === 'SI') return 'Pagado';
  if (upper === 'NO') return 'No pagado';
  if (upper === 'PENDIENTE') return 'Pendiente';
  return status;
}

function cleanPremium(premium: string): string {
  // Remove commas and convert to proper format
  return premium.replace(/,/g, '').replace(/\s+/g, '').trim();
}

async function main() {
  const sapsPath = process.argv[2];
  const pdfBasePath = process.argv[3];
  
  if (!sapsPath || !pdfBasePath) {
    console.log('Uso: tsx scripts/preview-saps-import.ts <saps-csv> <pdf-folder>');
    process.exit(1);
  }
  
  console.log('Previsualizando datos de importación SAPS...');
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
  
  for (const [policyNum, record] of sapsPolicies) {
    const match = findBestMatchingPdf(record, pdfs);
    if (match) {
      toImport.push({ record, pdfPath: match.filePath });
    }
  }
  
  console.log('=' .repeat(120));
  console.log('DATOS A IMPORTAR');
  console.log('=' .repeat(120));
  console.log('');
  
  console.log('Póliza   | Cliente                    | Aseguradora              | Inicio Vigencia | Fin Vigencia | Frecuencia | Prima Total | Status       | Archivo PDF');
  console.log('-'.repeat(150));
  
  toImport.slice(0, 20).forEach(item => {
    const { record, pdfPath } = item;
    const policy = record.policyNumber.padEnd(9);
    const client = record.clientName.substring(0, 26).padEnd(26);
    const insurer = mapInsurerName(record.insurerName).substring(0, 24).padEnd(24);
    const startDate = record.startDate.padEnd(15);
    const endDate = record.endDate.padEnd(12);
    const frequency = mapPaymentFrequency(record.paymentFrequency).padEnd(10);
    const prima = cleanPremium(record.primaTotal).padEnd(12);
    const status = mapStatus(record.status).padEnd(12);
    const file = path.basename(pdfPath).substring(0, 30);
    
    console.log(`${policy} | ${client} | ${insurer} | ${startDate} | ${endDate} | ${frequency} | ${prima} | ${status} | ${file}`);
  });
  
  if (toImport.length > 20) {
    console.log(`... y ${toImport.length - 20} pólizas más`);
  }
  
  console.log('');
  console.log('=' .repeat(120));
  console.log(`Total a importar: ${toImport.length} pólizas`);
  console.log('=' .repeat(120));
  
  // Check for potential issues
  console.log('');
  console.log('VERIFICACIÓN DE CALIDAD:');
  console.log('');
  
  // Check for missing start dates
  const missingDates = toImport.filter(item => !item.record.startDate);
  if (missingDates.length > 0) {
    console.log(`⚠️  ${missingDates.length} pólizas sin fecha de inicio`);
  }
  
  // Check for missing premiums
  const missingPremiums = toImport.filter(item => !item.record.primaTotal);
  if (missingPremiums.length > 0) {
    console.log(`⚠️  ${missingPremiums.length} pólizas sin prima total`);
  }
  
  // Check for generic insurer names
  const genericInsurers = toImport.filter(item => 
    item.record.insurerName.includes('PARTICULAR') || 
    item.record.insurerName.includes('PREVENTIVO')
  );
  if (genericInsurers.length > 0) {
    console.log(`⚠️  ${genericInsurers.length} pólizas con aseguradora genérica`);
    genericInsurers.forEach(item => {
      console.log(`   - ${item.record.policyNumber}: ${item.record.insurerName}`);
    });
  }
  
  // Check for cancelled policies
  const cancelled = toImport.filter(item => 
    item.record.status.toUpperCase().includes('CANCELADO')
  );
  if (cancelled.length > 0) {
    console.log(`⚠️  ${cancelled.length} pólizas canceladas`);
  }
}

main().catch(console.error);
