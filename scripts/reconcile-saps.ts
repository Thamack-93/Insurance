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

async function scanPdfs(basePath: string): Promise<Array<{ filePath: string; text: string }>> {
  const results: Array<{ filePath: string; text: string }> = [];
  
  async function scanDir(dir: string) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        try {
          const buffer = await fs.promises.readFile(fullPath);
          const parser = new PDFParse({ data: buffer });
          const textResult = await parser.getText();
          results.push({ filePath: fullPath, text: textResult.text });
        } catch {
          // Skip failed PDFs
        }
      }
    }
  }
  
  await scanDir(basePath);
  return results;
}

function normalizePolicyNumber(num: string): string {
  // Remove spaces, dashes, dots AND leading zeros
  return num.toUpperCase().replace(/\s+/g, '').replace(/[-.]/g, '').replace(/^0+/, '');
}

function findPolicyInPdfs(policyNumber: string, pdfs: Array<{ filePath: string; text: string }>): string | null {
  const normTarget = normalizePolicyNumber(policyNumber);
  
  for (const pdf of pdfs) {
    const normText = normalizePolicyNumber(pdf.text);
    if (normText.includes(normTarget)) {
      return pdf.filePath;
    }
  }
  
  // Try partial match (last 6-7 digits)
  const partialMatch = normTarget.slice(-7);
  for (const pdf of pdfs) {
    const normText = normalizePolicyNumber(pdf.text);
    if (normText.includes(partialMatch)) {
      return pdf.filePath;
    }
  }
  
  return null;
}

async function main() {
  const sapsPath = process.argv[2];
  const pdfBasePath = process.argv[3];
  
  if (!sapsPath || !pdfBasePath) {
    console.log('Uso: tsx scripts/reconcile-saps.ts <saps-csv> <pdf-folder>');
    console.log('Ejemplo: tsx scripts/reconcile-saps.ts Downloads/DescargaSAPS.csv \"Polizas Pedro/Clientes\"');
    process.exit(1);
  }
  
  console.log('Reconciliando SAPS con PDFs...');
  console.log(`SAPS: ${sapsPath}`);
  console.log(`PDFs: ${pdfBasePath}`);
  console.log('');
  
  // Load SAPS data
  const sapsRecords = parseSapsCsv(sapsPath);
  console.log(`Registros SAPS: ${sapsRecords.length}`);
  
  // Get unique policies from SAPS
  const sapsPolicies = new Map<string, SapsRecord>();
  for (const record of sapsRecords) {
    if (!sapsPolicies.has(record.policyNumber)) {
      sapsPolicies.set(record.policyNumber, record);
    }
  }
  console.log(`Pólizas únicas en SAPS: ${sapsPolicies.size}`);
  console.log('');
  
  // Scan all PDFs
  console.log('Escaneando PDFs (esto puede tomar unos minutos)...');
  const pdfs = await scanPdfs(pdfBasePath);
  console.log(`PDFs escaneados: ${pdfs.length}`);
  console.log('');
  
  // Match SAPS policies to PDFs
  const matched: Array<{ policy: string; client: string; insurer: string; file: string }> = [];
  const unmatched: Array<{ policy: string; client: string; insurer: string }> = [];
  
  for (const [policyNum, record] of sapsPolicies) {
    const file = findPolicyInPdfs(policyNum, pdfs);
    if (file) {
      matched.push({
        policy: policyNum,
        client: record.clientName,
        insurer: record.insurerName,
        file: path.basename(file)
      });
    } else {
      unmatched.push({
        policy: policyNum,
        client: record.clientName,
        insurer: record.insurerName
      });
    }
  }
  
  // Results
  console.log('=' .repeat(80));
  console.log('RESULTADOS DE RECONCILIACIÓN');
  console.log('=' .repeat(80));
  console.log('');
  
  console.log(`✅ Encontradas (${matched.length}/${sapsPolicies.size}):`);
  matched.slice(0, 15).forEach(m => {
    console.log(`  ${m.policy} | ${m.client.substring(0, 30).padEnd(30)} | ${m.file.substring(0, 40)}`);
  });
  if (matched.length > 15) {
    console.log(`  ... y ${matched.length - 15} más`);
  }
  console.log('');
  
  console.log(`❌ No encontradas (${unmatched.length}):`);
  unmatched.forEach(u => {
    console.log(`  ${u.policy} | ${u.client} | ${u.insurer}`);
  });
  console.log('');
  
  console.log('=' .repeat(80));
  console.log(`Total: ${matched.length} de ${sapsPolicies.size} pólizas SAPS encontradas en PDFs (${((matched.length/sapsPolicies.size)*100).toFixed(1)}%)`);
  console.log('=' .repeat(80));
}

main().catch(console.error);
