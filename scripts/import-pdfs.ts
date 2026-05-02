import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import {
  backupDatabase,
  closeDb,
  createDb,
  formatDateShort,
  normalizeKey,
  printTable,
  safeJson,
  toDateValue,
  toEnumValue,
  toNumber,
  toNumberValue,
  toStringValue,
} from "./_shared";

const POLICY_TYPES = [
  "AUTO", "GMM", "VIDA", "DANOS", "FIANZAS", "HOGAR",
  "RESPONSABILIDAD_CIVIL", "EMPRESARIAL", "ACCIDENTES", "OTRO",
] as const;

const POLICY_STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED", "RENEWED", "PENDING"] as const;

const PAYMENT_FREQUENCIES = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "SINGLE", "OTHER"] as const;

const CURRENCIES = ["MXN", "USD"] as const;

// Mexican Insurance Companies Database
interface InsurerInfo {
  name: string;
  rfc: string;
  keywords: string[];
}

const MEXICAN_INSURERS: InsurerInfo[] = [
  { name: "GNP Seguros", rfc: "GNP901221SM4", keywords: ["GNP", "GRUPO NACIONAL PROVINCIAL", "GNP SEGUROS"] },
  { name: "AXA Seguros", rfc: "ASE901221SM4", keywords: ["AXA", "AXA SEGUROS", "AXA MÉXICO"] },
  { name: "Qualitas Compañía de Seguros", rfc: "QCS901221SM4", keywords: ["QUALITAS", "QUÁLITAS", "QCS"] },
  { name: "Mapfre México", rfc: "MTE901221SM4", keywords: ["MAPFRE", "MAPFRE MÉXICO", "MAPFRE TEPEYAC"] },
  { name: "Chubb Seguros México", rfc: "CSE901221SM4", keywords: ["CHUBB", "CHUBB SEGUROS", "CHUBB DE MÉXICO"] },
  { name: "Zurich Seguros", rfc: "ZSE901221SM4", keywords: ["ZURICH", "ZURICH SEGUROS", "ZURICH MÉXICO"] },
  { name: "MetLife México", rfc: "MTL901221SM4", keywords: ["METLIFE", "MET LIFE", "METLIFE MÉXICO"] },
  { name: "Allianz México", rfc: "ALZ901221SM4", keywords: ["ALLIANZ", "ALLIANZ MÉXICO", "ALLIANZ SEGUROS"] },
  { name: "Banorte Seguros", rfc: "BNT901221SM4", keywords: ["BANORTE", "BANORTE SEGUROS", "BANORTE ASEGURADORA"] },
  { name: "HSBC Seguros", rfc: "HSE901221SM4", keywords: ["HSBC", "HSBC SEGUROS", "HSBC MÉXICO"] },
  { name: "Inbursa Seguros", rfc: "ISE901221SM4", keywords: ["INBURSA", "INBURSA SEGUROS", "GRUPO FINANCIERO INBURSA"] },
  { name: "Santander Seguros", rfc: "SSE901221SM4", keywords: ["SANTANDER", "SANTANDER SEGUROS", "SANTANDER MÉXICO"] },
  { name: "BBVA Seguros", rfc: "BSE901221SM4", keywords: ["BBVA", "BBVA SEGUROS", "BBVA BANCOMER SEGUROS"] },
  { name: "Citibanamex Seguros", rfc: "CSE901221SM4", keywords: ["CITIBANAMEX", "BANAMEX", "CITIBANAMEX SEGUROS"] },
  { name: "Atlas Seguros", rfc: "ASE901221SM4", keywords: ["ATLAS", "ATLAS SEGUROS", "ATLAS CIA DE SEGUROS"] },
  { name: "Ana Seguros", rfc: "ASE901221SM4", keywords: ["ANA", "ANA SEGUROS", "ANA CIA DE SEGUROS"] },
  { name: "Bupa México", rfc: "BPA901221SM4", keywords: ["BUPA", "BUPA MÉXICO", "BUPA SEGUROS"] },
  { name: "Seguros Afirme", rfc: "ASE901221SM4", keywords: ["AFIRME", "AFIRME SEGUROS", "SEGUROS AFIRME"] },
  { name: "Seguros Monterrey New York Life", rfc: "MNY901221SM4", keywords: ["MONTERREY NEW YORK LIFE", "MNYL", "SEGUROS MONTERREY"] },
  { name: "Seguros Ve por Más", rfc: "VPM901221SM4", keywords: ["VE POR MÁS", "VEPORMAS", "SEGUROS VE POR MÁS"] },
];

interface ExtractedPolicyData {
  policyNumber?: string;
  policyType?: string;
  clientName?: string;
  insurerName?: string;
  startDate?: Date;
  endDate?: Date;
  renewalDate?: Date;
  premiumAmount?: number;
  currency?: string;
  paymentFrequency?: string;
  insuredObject?: string;
  beneficiaryInfo?: string;
  status?: string;
  notes?: string;
}

interface ExtractedReceiptData {
  receiptNumber?: string;
  periodStartDate?: Date;
  periodEndDate?: Date;
  dueDate?: Date;
  amount?: number;
  currency?: string;
  paidDate?: Date;
  paymentMethod?: string;
}

interface ExtractedQuoteData {
  quoteNumber?: string;
  policyType?: string;
  requestedDate?: Date;
  sentDate?: Date;
  validUntil?: Date;
  quotedAmount?: number;
  status?: string;
}

interface ParsedDocument {
  type: "POLICY" | "RECEIPT" | "QUOTE" | "OTHER";
  clientName: string;
  insurerName?: string;
  policyData?: ExtractedPolicyData;
  receiptData?: ExtractedReceiptData;
  quoteData?: ExtractedQuoteData;
  rawText: string;
}

function extractWithPatterns(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function parseMexicanDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  
  // Try various date formats common in Mexican insurance docs
  const formats = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,  // DD/MM/YYYY or DD-MM-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})/,   // DD/MM/YY or DD-MM-YY
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,  // YYYY/MM/DD
  ];
  
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      let day: number, month: number, year: number;
      
      if (match[0].startsWith(match[1]) && parseInt(match[1]) > 31) {
        // YYYY/MM/DD format
        year = parseInt(match[1]);
        month = parseInt(match[2]) - 1;
        day = parseInt(match[3]);
      } else {
        // Assume DD/MM/YYYY
        day = parseInt(match[1]);
        month = parseInt(match[2]) - 1;
        year = parseInt(match[3]);
        if (year < 100) year += year < 50 ? 2000 : 1900;
      }
      
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) return date;
    }
  }
  
  return toDateValue(dateStr) ?? undefined;
}

function detectDocumentType(text: string): "POLICY" | "RECEIPT" | "QUOTE" | "OTHER" {
  const upperText = text.toUpperCase();
  
  // Receipt indicators
  if (/RECIBO|RECIBO DE PRIMA|COMPROBANTE DE PAGO|PAGO DE PRIMA/i.test(upperText)) {
    return "RECEIPT";
  }
  
  // Quote indicators
  if (/COTIZACION|COTIZACI[ÓO]N|PROPUESTA DE SEGURO|PRESUPUESTO/i.test(upperText)) {
    return "QUOTE";
  }
  
  // Policy indicators
  if (/P[ÓO]LIZA|CONDICIONES GENERALES|CERTIFICADO DE SEGURO|CAR[ÁA]TULA/i.test(upperText)) {
    return "POLICY";
  }
  
  return "OTHER";
}

function extractPolicyNumber(text: string): string | undefined {
  const patterns = [
    // Specific patterns for Mexican insurers
    /N[ÚU]M(?:ERO)?\.?\s*DE\s*P[ÓO]LIZA[\s:]*([A-Z]{0,3}[\s\-]?\d[\d\-\/\.]{5,20})/i,
    /(?:P[ÓO]LIZA|PÓLIZA DE SEGURO)\s+(?:NO\.?\s*)?([A-Z]{0,3}[\s\-]?\d[\d\-\/\.]{5,20})/i,
    /P[ÓO]LIZA\s*:?\s*([A-Z]{0,3}\d[\d\-]{5,15})/i,
    // GNP pattern: typically letters + numbers like M9 43010017
    /\b([A-Z]\d{1,2}\s+\d{7,9})\b/,
    // Qualitas/AXA pattern: numeric with dashes like 0002-0003-2017
    /\b(\d{3,4}[\-]\d{3,4}[\-]\d{4})\b/,
    // General: avoid short sequences that look like dates
    /\b([A-Z]*\d{8,12})\b/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const num = match[1].trim();
      // Exclude if it looks like a date (DD/MM/YYYY patterns)
      if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(num)) continue;
      // Exclude if it looks like an RFC
      if (/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i.test(num)) continue;
      // Must have some substance
      if (num.length >= 6 && num.length <= 25) return num;
    }
  }
  return undefined;
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateNameSimilarity(name1: string, name2: string): number {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);
  
  // Split into words and compare
  const words1 = norm1.split(" ");
  const words2 = norm2.split(" ");
  
  let matches = 0;
  for (const w1 of words1) {
    if (w1.length < 2) continue; // Skip short words
    for (const w2 of words2) {
      if (w2.length < 2) continue;
      if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
        matches++;
        break;
      }
    }
  }
  
  const maxWords = Math.max(words1.length, words2.length);
  return maxWords > 0 ? matches / maxWords : 0;
}

function extractClientName(text: string, folderName: string): string {
  const patterns = [
    /(?:CONTRATANTE|TITULAR|ASEGURADO(?:\s+PRINCIPAL)?|NOMBRE(?:\s+DEL)?\s*CLIENTE)[\s:]*([^\n]{5,80})/i,
    /(?:NOMBRE|RAZ[ÓO]N\s+SOCIAL)(?:\s+DEL\s+ASEGURADO)?[\s:]*([^\n]{5,80})/i,
    /(?:EL\s+)?ASEGURADO[\s:]*ES?[\s:]*([^\n]{5,80})/i,
  ];
  
  const extracted = extractWithPatterns(text, patterns);
  
  if (!extracted) {
    // No name found in PDF, use folder name but clean it up
    return cleanFolderName(folderName);
  }
  
  // Clean up extracted name
  let cleanExtracted = extracted
    .replace(/\s+/g, " ")
    .replace(/^[\s:.-]+/, "")
    .replace(/[\s:.-]+$/, "")
    .trim();
  
  // Compare with folder name
  const similarity = calculateNameSimilarity(cleanExtracted, folderName);
  
  // If they're very different, the PDF name might be wrong or generic
  // Use folder name if it's more specific
  if (similarity < 0.3) {
    // Check if extracted looks like a valid person/company name
    const extractedWords = cleanExtracted.split(" ").filter(w => w.length > 2);
    const folderWords = folderName.split(/[-_\s]/).filter(w => w.length > 2);
    
    // Prefer folder if it has more name components
    if (folderWords.length >= extractedWords.length) {
      return cleanFolderName(folderName);
    }
  }
  
  return cleanExtracted;
}

function cleanFolderName(folderName: string): string {
  // Remove common suffixes like " - GNP", " - Qualitas", etc.
  return folderName
    .replace(/\s*-\s*(GNP|Qualitas|AXA|Mapfre|Chubb|Zurich|GNP Seguros|Qualitas Seguros)/i, "")
    .replace(/\s*-\s*(Autos|GMM|Vida|Hogar|Daños)/i, "")
    .trim();
}

function extractInsurerFromText(text: string): InsurerInfo | null {
  const upperText = text.toUpperCase();
  
  // Check for RFC patterns first (most reliable)
  const rfcPattern = /R\.?F\.?C\.?[\s:]*([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i;
  const rfcMatch = text.match(rfcPattern);
  
  if (rfcMatch?.[1]) {
    const foundRfc = rfcMatch[1].toUpperCase();
    const byRfc = MEXICAN_INSURERS.find(i => i.rfc === foundRfc);
    if (byRfc) return byRfc;
  }
  
  // Check by keywords
  for (const insurer of MEXICAN_INSURERS) {
    for (const keyword of insurer.keywords) {
      if (upperText.includes(keyword)) {
        return insurer;
      }
    }
  }
  
  // Try generic patterns as fallback
  const genericPatterns = [
    /(?:ASEGURADORA|COMPA[ÑN][ÍI]A DE SEGUROS)[\s:]*([A-Z][A-Z\s]+(?:S\.?A\.?|DE\.?C\.?V\.?)?)/i,
  ];
  
  for (const pattern of genericPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim();
      // Try to match against known insurers
      const normalized = name.toUpperCase().replace(/\s+/g, ' ');
      const known = MEXICAN_INSURERS.find(i => 
        i.keywords.some(k => normalized.includes(k))
      );
      if (known) return known;
    }
  }
  
  return null;
}

function extractPolicyType(text: string): string | undefined {
  const upperText = text.toUpperCase();
  
  if (/GASTOS M[ÉE]DICOS|G\.?M\.?M\.?|MAYORES|GASTOS M[ÉE]DICOS MAYORES/i.test(upperText)) return "GMM";
  if (/VIDA|VITALICIO|SEGURO DE VIDA/i.test(upperText)) return "VIDA";
  if (/AUTO|AUTOS|VEH[ÍI]CULO|CARRO|AUTOMOVIL|AUTOM[ÓO]VIL/i.test(upperText)) return "AUTO";
  if (/HOGAR|CASA|VIVIENDA|RESIDENCIAL|INMUEBLE/i.test(upperText)) return "HOGAR";
  if (/DA[ÑN]OS|RESPONSABILIDAD CIVIL|RC/i.test(upperText)) return "DANOS";
  if (/FIANZA|FIANZAS/i.test(upperText)) return "FIANZAS";
  if (/EMPRESARIAL|PYME|COMERCIAL|NEGOCIOS/i.test(upperText)) return "EMPRESARIAL";
  if (/ACCIDENTES|ACCIDENTES PERSONALES/i.test(upperText)) return "ACCIDENTES";
  if (/RESPONSABILIDAD CIVIL PROFESIONAL/i.test(upperText)) return "RESPONSABILIDAD_CIVIL";
  
  return "OTRO";
}

function extractAmount(text: string, labelPatterns: string[]): number | undefined {
  for (const label of labelPatterns) {
    const regex = new RegExp(`${label}[\s:]*[$]?\s*([\d,]+\.?\d{0,2})`, "i");
    const match = text.match(regex);
    if (match?.[1]) {
      const cleaned = match[1].replace(/,/g, "");
      const num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return undefined;
}

function extractCurrency(text: string): string {
  if (/USD|D[ÓO]LARES?|DOLLARS?/i.test(text)) return "USD";
  return "MXN";
}

function extractPaymentFrequency(text: string): string | undefined {
  const upperText = text.toUpperCase();
  if (/ANUAL|AÑO|YEARLY/i.test(upperText)) return "ANNUAL";
  if (/MENSUAL|MES|MONTHLY/i.test(upperText)) return "MONTHLY";
  if (/TRIMESTRAL|TRIMESTRE|QUARTERLY/i.test(upperText)) return "QUARTERLY";
  if (/SEMESTRAL|SEMESTRE|SEMIANNUAL/i.test(upperText)) return "SEMIANNUAL";
  if (/UNICO|PAGO [ÚU]NICO|SINGLE/i.test(upperText)) return "SINGLE";
  return "OTHER";
}

function extractDates(text: string): { startDate?: Date; endDate?: Date; renewalDate?: Date } {
  const patterns = [
    /(?:VIGENCIA|PERIODO)[\s:]*DEL?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*(?:AL|HASTA)?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:FECHA DE INICIO|INICIO DE VIGENCIA)[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:FECHA DE FIN|FIN DE VIGENCIA|VIGENCIA HASTA)[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:RENOVACI[ÓO]N|FECHA DE RENOVACI[ÓO]N)[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
  ];
  
  const result: { startDate?: Date; endDate?: Date; renewalDate?: Date } = {};
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[1] && !result.startDate) result.startDate = parseMexicanDate(match[1]);
      if (match[2] && !result.endDate) result.endDate = parseMexicanDate(match[2]);
    }
  }
  
  return result;
}

function parsePolicyDocument(text: string, folderName: string): ParsedDocument {
  const doc: ParsedDocument = {
    type: "POLICY",
    clientName: extractClientName(text, folderName),
    rawText: text,
  };
  
  const dates = extractDates(text);
  
  const insurerInfo = extractInsurerFromText(text);
  
  doc.policyData = {
    policyNumber: extractPolicyNumber(text),
    policyType: extractPolicyType(text),
    clientName: doc.clientName,
    insurerName: insurerInfo?.name,
    startDate: dates.startDate,
    endDate: dates.endDate,
    renewalDate: dates.renewalDate,
    premiumAmount: extractAmount(text, ["PRIMA", "PRIMA TOTAL", "MONTO DE PRIMA", "PREMIO", "PREMIO TOTAL"]),
    currency: extractCurrency(text),
    paymentFrequency: extractPaymentFrequency(text),
    insuredObject: extractWithPatterns(text, [/OBJETO ASEGURADO[\s:]*([^\n]+)/i, /BIEN ASEGURADO[\s:]*([^\n]+)/i]),
    beneficiaryInfo: extractWithPatterns(text, [/BENEFICIARIO[\s:]*([^\n]+)/i, /BENEFICIARIOS?[\s:]*([^\n]+)/i]),
    status: "ACTIVE",
  };
  
  doc.insurerName = insurerInfo?.name;
  
  return doc;
}

function parseReceiptDocument(text: string, folderName: string): ParsedDocument {
  const doc: ParsedDocument = {
    type: "RECEIPT",
    clientName: extractClientName(text, folderName),
    rawText: text,
  };
  
  const dates = extractDates(text);
  const insurerInfo = extractInsurerFromText(text);
  
  doc.receiptData = {
    receiptNumber: extractWithPatterns(text, [
      /N[ÚU]MERO DE RECIBO[\s:]*(\d+)/i,
      /RECIBO NO\.?[\s:]*(\d+)/i,
      /FOLIO[\s:]*(\d+)/i,
      /RECIBO[\s:]*([A-Z\d\-]+)/i,
    ]),
    periodStartDate: dates.startDate,
    periodEndDate: dates.endDate,
    dueDate: extractWithPatterns(text, [/FECHA DE VENCIMIENTO[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i]) 
      ? parseMexicanDate(extractWithPatterns(text, [/FECHA DE VENCIMIENTO[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])!)
      : undefined,
    amount: extractAmount(text, ["IMPORTE", "MONTO", "TOTAL", "CANTIDAD", "PRIMA"]),
    currency: extractCurrency(text),
    paidDate: extractWithPatterns(text, [/FECHA DE PAGO[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])
      ? parseMexicanDate(extractWithPatterns(text, [/FECHA DE PAGO[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])!)
      : undefined,
    paymentMethod: extractWithPatterns(text, [/M[ÉE]TODO DE PAGO[\s:]*([^\n]+)/i, /FORMA DE PAGO[\s:]*([^\n]+)/i]),
  };
  
  doc.insurerName = insurerInfo?.name;
  
  return doc;
}

function parseQuoteDocument(text: string, folderName: string): ParsedDocument {
  const doc: ParsedDocument = {
    type: "QUOTE",
    clientName: extractClientName(text, folderName),
    rawText: text,
  };
  
  doc.quoteData = {
    quoteNumber: extractWithPatterns(text, [
      /N[ÚU]MERO DE COTIZACI[ÓO]N[\s:]*(\w+)/i,
      /COTIZACI[ÓO]N NO\.?[\s:]*(\w+)/i,
      /FOLIO[\s:]*(\w+)/i,
    ]),
    policyType: extractPolicyType(text),
    requestedDate: extractWithPatterns(text, [/FECHA DE SOLICITUD[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])
      ? parseMexicanDate(extractWithPatterns(text, [/FECHA DE SOLICITUD[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])!)
      : new Date(),
    sentDate: extractWithPatterns(text, [/FECHA DE ENV[ÍI]O[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])
      ? parseMexicanDate(extractWithPatterns(text, [/FECHA DE ENV[ÍI]O[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])!)
      : undefined,
    validUntil: extractWithPatterns(text, [/V[ÁA]LIDA HASTA[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])
      ? parseMexicanDate(extractWithPatterns(text, [/V[ÁA]LIDA HASTA[\s:]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i])!)
      : undefined,
    quotedAmount: extractAmount(text, ["PRIMA", "COTIZACI[ÓO]N", "MONTO", "TOTAL", "IMPORTE"]),
    status: "REQUESTED",
  };
  
  return doc;
}

async function parsePdfFile(filePath: string, folderName: string): Promise<ParsedDocument | null> {
  try {
    // Check file size first
    const stats = await stat(filePath);
    if (stats.size === 0) {
      console.log(`  Saltando archivo vacio: ${path.basename(filePath)}`);
      return null;
    }
    
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const text = textResult.text;
    
    const docType = detectDocumentType(text);
    
    switch (docType) {
      case "POLICY":
        return parsePolicyDocument(text, folderName);
      case "RECEIPT":
        return parseReceiptDocument(text, folderName);
      case "QUOTE":
        return parseQuoteDocument(text, folderName);
      default:
        return {
          type: "OTHER",
          clientName: folderName,
          rawText: text,
        };
    }
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

async function scanDirectory(basePath: string): Promise<Array<{ filePath: string; folderName: string; parsed: ParsedDocument }>> {
  const results: Array<{ filePath: string; folderName: string; parsed: ParsedDocument }> = [];
  
  async function scanDir(dirPath: string, folderName: string) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath, entry.name);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        const parsed = await parsePdfFile(fullPath, folderName);
        if (parsed) {
          results.push({ filePath: fullPath, folderName, parsed });
        }
      }
    }
  }
  
  await scanDir(basePath, path.basename(basePath));
  return results;
}

function normalizeComparable(value: unknown): string {
  return normalizeKey(String(value ?? ""));
}

async function resolveOrCreateInsurer(db: ReturnType<typeof createDb>, insurerName: string | undefined, existingInsurers: Array<{ id: string; name: string }>) {
  if (!insurerName) return null;
  
  const target = normalizeComparable(insurerName);
  const match = existingInsurers.find(i => normalizeComparable(i.name) === target);
  
  if (match) return match;
  
  // Create new insurer
  const created = await db.insurer.create({
    data: {
      name: insurerName,
      status: "ACTIVE",
    },
  });
  
  existingInsurers.push(created);
  console.log(`  Creada aseguradora: ${insurerName}`);
  return created;
}

async function resolveOrCreateClient(db: ReturnType<typeof createDb>, clientName: string, existingClients: Array<{ id: string; fullName: string }>) {
  const target = normalizeComparable(clientName);
  const match = existingClients.find(c => normalizeComparable(c.fullName) === target);
  
  if (match) return match;
  
  // Create new client
  const created = await db.client.create({
    data: {
      fullName: clientName,
      type: clientName.includes("SA") || clientName.includes("S.A.") || clientName.includes("CV") ? "COMPANY" : "PERSON",
      status: "ACTIVE",
    },
  });
  
  existingClients.push(created);
  console.log(`  Creado cliente: ${clientName}`);
  return created;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const basePath = args.find(a => !a.startsWith("-"));
  
  if (!basePath) {
    console.log("Uso: npm run import:pdfs <ruta-a-carpeta-clientes> [--dry-run]");
    console.log("");
    console.log("Ejemplo:");
    console.log('  npm run import:pdfs "/Users/pedrogomez/Desktop/escritorio/polizas pedro/clientes"');
    console.log("");
    console.log("Opciones:");
    console.log("  --dry-run, -n    Simular sin hacer cambios");
    process.exit(1);
  }
  
  console.log("Importacion de PDFs de polizas");
  console.log(`Ruta: ${basePath}`);
  console.log(`Modo simulacion: ${dryRun ? "SI" : "NO"}`);
  console.log("");
  
  // Verify path exists
  try {
    await stat(basePath);
  } catch {
    console.error(`Error: No se encuentra la ruta: ${basePath}`);
    process.exit(1);
  }
  
  // Scan all PDFs
  console.log("Escaneando PDFs...");
  const scanned = await scanDirectory(basePath);
  console.log(`Encontrados ${scanned.length} PDFs`);
  console.log("");
  
  if (scanned.length === 0) {
    console.log("No se encontraron PDFs para procesar.");
    process.exit(0);
  }
  
  // Deduplicate and resolve conflicts
  const policyNumberMap = new Map<string, Array<{ index: number; insurer: string | undefined; type: string; file: string }>>();
  
  scanned.forEach((item, index) => {
    const policyNum = item.parsed.policyData?.policyNumber;
    if (policyNum) {
      const normalized = normalizeComparable(policyNum);
      if (!policyNumberMap.has(normalized)) {
        policyNumberMap.set(normalized, []);
      }
      policyNumberMap.get(normalized)!.push({
        index,
        insurer: item.parsed.insurerName,
        type: item.parsed.type,
        file: path.basename(item.filePath),
      });
    }
  });
  
  // Resolve conflicts: same policy number, different insurers
  const conflicts: string[] = [];
  for (const [policyNum, items] of policyNumberMap.entries()) {
    const insurers = new Set(items.map(i => i.insurer).filter(Boolean));
    if (insurers.size > 1) {
      // Find the main POLICY document (prefer over RECEIPT/OTHER)
      const policyDocs = items.filter(i => i.type === "POLICY");
      if (policyDocs.length > 0) {
        // Use the insurer from the first policy document
        const correctInsurer = policyDocs[0].insurer;
        conflicts.push(`${policyNum}: ${Array.from(insurers).join(" vs ")} -> usando ${correctInsurer}`);
        
        // Update all scanned items for this policy number
        for (const item of items) {
          if (item.insurer !== correctInsurer) {
            scanned[item.index].parsed.insurerName = correctInsurer;
            if (scanned[item.index].parsed.policyData) {
              scanned[item.index].parsed.policyData!.insurerName = correctInsurer;
            }
          }
        }
      }
    }
  }
  
  if (conflicts.length > 0) {
    console.log("Conflictos resueltos (misma poliza, diferente aseguradora):");
    conflicts.forEach(c => console.log(`  - ${c}`));
    console.log("");
  }
  
  // Show preview
  const preview = scanned.map(s => ({
    Archivo: path.basename(s.filePath),
    Cliente: s.parsed.clientName.substring(0, 30),
    Tipo: s.parsed.type,
    Poliza: s.parsed.policyData?.policyNumber || "-",
    Aseguradora: s.parsed.insurerName?.substring(0, 20) || "-",
  }));
  
  printTable("Vista previa de documentos", preview.slice(0, 15));
  
  if (dryRun) {
    console.log("\nModo simulacion - no se realizaron cambios.");
    console.log("Ejecuta sin --dry-run para importar.");
    process.exit(0);
  }
  
  // Confirm
  console.log("\nProcediendo con la importacion...");
  
  const db = createDb();
  
  // Load existing data
  const [existingClients, existingInsurers, existingPolicies] = await Promise.all([
    db.client.findMany({ select: { id: true, fullName: true } }),
    db.insurer.findMany({ select: { id: true, name: true } }),
    db.policy.findMany({
      select: { id: true, policyNumber: true, clientId: true, insurerId: true },
    }),
  ]);
  
  // Backup first
  const backup = await backupDatabase();
  if (backup) {
    console.log(`Backup creado: ${backup}`);
  }
  
  const stats = {
    clientsCreated: 0,
    insurersCreated: 0,
    policiesCreated: 0,
    policiesUpdated: 0,
    receiptsCreated: 0,
    quotesCreated: 0,
    documentsCreated: 0,
    errors: 0,
  };
  
  for (const { filePath, folderName, parsed } of scanned) {
    try {
      console.log(`\nProcesando: ${path.basename(filePath)}`);
      
      // Resolve or create client
      const client = await resolveOrCreateClient(db, parsed.clientName, existingClients);
      if (!client) {
        console.log("  ERROR: No se pudo resolver cliente");
        stats.errors++;
        continue;
      }
      
      // Resolve or create insurer
      const insurerName = parsed.insurerName || parsed.policyData?.insurerName;
      const insurer = insurerName 
        ? await resolveOrCreateInsurer(db, insurerName, existingInsurers)
        : null;
      
      if (parsed.type === "POLICY" && parsed.policyData) {
        const data = parsed.policyData;
        
        // Check for existing policy
        const existingPolicy = data.policyNumber
          ? existingPolicies.find(p => normalizeComparable(p.policyNumber) === normalizeComparable(data.policyNumber!))
          : null;
        
        let policyId: string;
        
        if (existingPolicy) {
          // Update existing policy
          await db.policy.update({
            where: { id: existingPolicy.id },
            data: {
              clientId: client.id,
              insurerId: insurer?.id || existingPolicy.insurerId,
              policyType: toEnumValue(data.policyType, POLICY_TYPES) || "OTRO",
              status: toEnumValue(data.status, POLICY_STATUSES) || "ACTIVE",
              startDate: data.startDate || new Date(),
              endDate: data.endDate || new Date(),
              renewalDate: data.renewalDate,
              premiumAmount: toNumber(data.premiumAmount) || 0,
              currency: data.currency || "MXN",
              paymentFrequency: toEnumValue(data.paymentFrequency, PAYMENT_FREQUENCIES) || "OTHER",
              insuredObject: data.insuredObject,
              beneficiaryInfo: data.beneficiaryInfo,
            },
          });
          policyId = existingPolicy.id;
          stats.policiesUpdated++;
          console.log(`  Actualizada poliza: ${data.policyNumber}`);
        } else {
          // Create new policy
          const policyNumber = data.policyNumber || `PDF-${Date.now()}-${stats.policiesCreated}`;
          const created = await db.policy.create({
            data: {
              policyNumber,
              clientId: client.id,
              insurerId: insurer?.id || existingInsurers[0]?.id,
              policyType: toEnumValue(data.policyType, POLICY_TYPES) || "OTRO",
              status: toEnumValue(data.status, POLICY_STATUSES) || "ACTIVE",
              startDate: data.startDate || new Date(),
              endDate: data.endDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
              renewalDate: data.renewalDate,
              premiumAmount: toNumber(data.premiumAmount) || 0,
              currency: data.currency || "MXN",
              paymentFrequency: toEnumValue(data.paymentFrequency, PAYMENT_FREQUENCIES) || "OTHER",
              insuredObject: data.insuredObject,
              beneficiaryInfo: data.beneficiaryInfo,
            },
          });
          policyId = created.id;
          existingPolicies.push({ id: created.id, policyNumber: created.policyNumber, clientId: created.clientId, insurerId: created.insurerId });
          stats.policiesCreated++;
          console.log(`  Creada poliza: ${policyNumber}`);
        }
        
        // Create document record
        await db.document.create({
          data: {
            clientId: client.id,
            policyId,
            documentType: "POLICY",
            fileName: path.basename(filePath),
            filePath: filePath,
            mimeType: "application/pdf",
            notes: `Importado desde PDF. Tipo detectado: ${parsed.type}`,
          },
        });
        stats.documentsCreated++;
        
      } else if (parsed.type === "RECEIPT" && parsed.receiptData) {
        const data = parsed.receiptData;
        
        // Find matching policy if possible
        const matchingPolicy = existingPolicies.find(p => p.clientId === client.id);
        
        const receipt = await db.receipt.create({
          data: {
            receiptNumber: data.receiptNumber || `REC-PDF-${Date.now()}`,
            policyId: matchingPolicy?.id || existingPolicies[0]?.id || "",
            clientId: client.id,
            insurerId: insurer?.id || existingInsurers[0]?.id || "",
            periodStartDate: data.periodStartDate || new Date(),
            periodEndDate: data.periodEndDate || new Date(),
            dueDate: data.dueDate || new Date(),
            amount: toNumber(data.amount) || 0,
            currency: data.currency || "MXN",
            status: data.paidDate ? "PAID" : "PENDING",
            paidDate: data.paidDate,
            paymentMethod: data.paymentMethod,
          },
        });
        stats.receiptsCreated++;
        console.log(`  Creado recibo: ${receipt.receiptNumber}`);
        
        // Create document record
        await db.document.create({
          data: {
            clientId: client.id,
            receiptId: receipt.id,
            documentType: "RECEIPT",
            fileName: path.basename(filePath),
            filePath: filePath,
            mimeType: "application/pdf",
            notes: `Importado desde PDF`,
          },
        });
        stats.documentsCreated++;
        
      } else if (parsed.type === "QUOTE" && parsed.quoteData) {
        const data = parsed.quoteData;
        
        const quote = await db.quote.create({
          data: {
            clientId: client.id,
            insurerId: insurer?.id,
            policyType: toEnumValue(data.policyType, POLICY_TYPES) || "OTRO",
            status: toEnumValue(data.status, ["REQUESTED", "IN_PROGRESS", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]) || "REQUESTED",
            requestedDate: data.requestedDate || new Date(),
            sentDate: data.sentDate,
            validUntil: data.validUntil,
            quotedAmount: toNumber(data.quotedAmount) || null,
            notes: `Importado desde PDF`,
          },
        });
        stats.quotesCreated++;
        console.log(`  Creada cotizacion: ${data.quoteNumber || quote.id}`);
        
        // Create document record
        await db.document.create({
          data: {
            clientId: client.id,
            quoteId: quote.id,
            documentType: "QUOTE",
            fileName: path.basename(filePath),
            filePath: filePath,
            mimeType: "application/pdf",
            notes: `Importado desde PDF`,
          },
        });
        stats.documentsCreated++;
      } else {
        // Other documents - just create document record
        await db.document.create({
          data: {
            clientId: client.id,
            documentType: "OTHER",
            fileName: path.basename(filePath),
            filePath: filePath,
            mimeType: "application/pdf",
            notes: `Importado desde PDF. Tipo detectado: ${parsed.type}`,
          },
        });
        stats.documentsCreated++;
        console.log(`  Creado documento (tipo: ${parsed.type})`);
      }
      
    } catch (error) {
      console.error(`  ERROR procesando ${filePath}:`, error);
      stats.errors++;
    }
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("RESUMEN DE IMPORTACION");
  console.log("=".repeat(50));
  console.log(`Clientes creados: ${stats.clientsCreated}`);
  console.log(`Aseguradoras creadas: ${stats.insurersCreated}`);
  console.log(`Polizas creadas: ${stats.policiesCreated}`);
  console.log(`Polizas actualizadas: ${stats.policiesUpdated}`);
  console.log(`Recibos creados: ${stats.receiptsCreated}`);
  console.log(`Cotizaciones creadas: ${stats.quotesCreated}`);
  console.log(`Documentos creados: ${stats.documentsCreated}`);
  console.log(`Errores: ${stats.errors}`);
  
  await closeDb(db);
  console.log("\nImportacion completada.");
}

main().catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
