export type BonusTier = { minimum: number; maximum?: number; rate: number };
export type BonusProgram = {
  key: string;
  label: string;
  policyTypes: string[];
  insurers: string[];
  period: "QUARTERLY" | "ANNUAL" | "FIRST_YEAR" | "ELIGIBILITY";
  accumulation: "YEAR_TO_DATE" | "QUARTER" | "YEAR" | "FIRST_POLICY_YEAR";
  tiers?: BonusTier[];
  growthRates?: { minimum: number; rates: Record<"20" | "40", number> }[];
  eligibilityOnly?: boolean;
  requiresEvidence: string[];
};

const tier = (minimum: number, rate: number, maximum?: number): BonusTier => ({ minimum, maximum, rate });

// Source: Cuaderno de Incentivos 2026. Every distinct rule interpretation is
// versioned per tenant alongside this immutable source PDF hash.
export const BONUS_PROGRAMS: BonusProgram[] = [
  // Autos paga trimestralmente contra PNP acumulada del año. Las bandas
  // continuas inician una unidad de precisión ($0.00000001) después del
  // límite superior impreso en la banda anterior.
  { key: "AUTO_2026", label: "Autos", policyTypes: ["AUTO"], insurers: ["QUALITAS", "ANA", "BANORTE", "HDI", "ZURICH"], period: "QUARTERLY", accumulation: "YEAR_TO_DATE", tiers: [tier(300000, .01, 500000), tier(500000.00000001, .02, 1250000), tier(1250000.00000001, .03, 2100000), tier(2100000.00000001, .04, 3300000), tier(3300000.00000001, .05, 5100000), tier(5100000.00000001, .06)], requiresEvidence: ["productEligible", "fleetUnder50", "autoExclusionsReviewed"] },
  // Daños Chubb es anual; la siniestralidad aplica a la cartera total Daños
  // del vendedor y se captura como evidencia del cierre, no por póliza.
  { key: "DAMAGE_CHUBB_2026", label: "Daños · Chubb", policyTypes: ["DANOS", "HOGAR", "RESPONSABILIDAD_CIVIL", "EMPRESARIAL", "OTRO"], insurers: ["CHUBB"], period: "ANNUAL", accumulation: "YEAR", tiers: [tier(150000, .005, 350000), tier(350000.00000001, .01, 750000), tier(750000.00000001, .02, 1000000), tier(1000000.00000001, .04, 2000000), tier(2000000.00000001, .06, 4000000), tier(4000000.00000001, .08, 8000000), tier(8000000.00000001, .10)], requiresEvidence: ["productEligible", "businessType", "specialConditionsReviewed", "directedBusinessReviewed", "frontingReviewed", "damageExclusionsReviewed"] },
  // Banorte, HDI y Zurich comparten una banda trimestral.
  { key: "DAMAGE_Q_2026", label: "Daños · Banorte / HDI / Zurich", policyTypes: ["DANOS", "HOGAR", "RESPONSABILIDAD_CIVIL", "EMPRESARIAL", "OTRO"], insurers: ["BANORTE", "HDI", "ZURICH"], period: "QUARTERLY", accumulation: "QUARTER", tiers: [tier(200000, .01, 300000), tier(300000.00000001, .02, 410000), tier(410000.00000001, .03, 530000), tier(530000.00000001, .04, 650000), tier(650000.00000001, .05, 950000), tier(950000.00000001, .06, 1400000), tier(1400000.00000001, .07)], requiresEvidence: ["productEligible", "businessType", "specialConditionsReviewed", "directedBusinessReviewed", "frontingReviewed", "damageExclusionsReviewed"] },
];

export const BONUS_RULE_SOURCE_HASH = "7834576632296e9b1135b9b65b7234693a58fef2053ea9b6a7ba7c52f816ef71";

export function resolveBonusProgram(key: string) {
  return BONUS_PROGRAMS.find((program) => program.key === key) ?? null;
}

export function selectBonusTier(amount: number, tiers: BonusTier[] = []) {
  return tiers.filter((entry) => amount >= entry.minimum && (entry.maximum === undefined || amount <= entry.maximum)).sort((a, b) => b.minimum - a.minimum)[0] ?? null;
}

export function damagePortfolioLossRatioStatus(value: number | null | undefined) {
  if (value === null || value === undefined) return "MISSING" as const;
  return value >= 0.5 ? "EXCLUDED" as const : "ELIGIBLE" as const;
}

export function selectGrowthBonusRate(amount: number, growth: number, tiers: NonNullable<BonusProgram["growthRates"]>) {
  const column = growth >= 0.4 ? "40" : growth >= 0.2 ? "20" : null;
  const tier = tiers.filter((entry) => amount >= entry.minimum).sort((a, b) => b.minimum - a.minimum)[0];
  return column && tier ? tier.rates[column] : null;
}

export function allianzLifeBonusRate(newPolicyCount: number) {
  return newPolicyCount >= 12 ? 0.13 : newPolicyCount >= 6 ? 0.06 : null;
}

export function normalizedInsurerName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
