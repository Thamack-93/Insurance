import { getDb } from "@/lib/db";
import { toNumber } from "@/lib/money";

export type DataQualityIssue = {
  code: string;
  etiqueta: string;
  descripcion: string;
  penalizacion: number;
};

export type ClientQualityScore = {
  clienteId: string;
  cliente: string;
  score: number;
  nivel: "Excelente" | "Bueno" | "Atención" | "Crítico";
  completitud: number;
  totalPolizas: number;
  polizasActivas: number;
  ingresosEstimados: number;
  issues: DataQualityIssue[];
};

export type PolicyQualityScore = {
  polizaId: string;
  poliza: string;
  clienteId: string;
  cliente: string;
  aseguradora: string;
  score: number;
  nivel: "Excelente" | "Bueno" | "Atención" | "Crítico";
  completitud: number;
  issues: DataQualityIssue[];
};

export async function getClientDataQualityScores() {
  const db = getDb();
  const clients = await db.client.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      secondaryPhone: true,
      address: true,
      rfc: true,
      preferredContactMethod: true,
      policies: {
        select: {
          status: true,
          premiumAmount: true,
        },
      },
    },
  });

  return clients
    .map<ClientQualityScore>((client) => {
      const issues: DataQualityIssue[] = [];
      let score = 100;

      if (!client.email) {
        issues.push({
          code: "CLIENT_EMAIL_MISSING",
          etiqueta: "Email faltante",
          descripcion: "El cliente no tiene correo electrónico registrado.",
          penalizacion: 20,
        });
        score -= 20;
      }

      if (!client.phone && !client.secondaryPhone) {
        issues.push({
          code: "CLIENT_PHONE_MISSING",
          etiqueta: "Teléfono faltante",
          descripcion: "El cliente no tiene teléfono principal ni secundario.",
          penalizacion: 20,
        });
        score -= 20;
      }

      if (!client.address) {
        issues.push({
          code: "CLIENT_ADDRESS_MISSING",
          etiqueta: "Dirección faltante",
          descripcion: "Falta la dirección postal del cliente.",
          penalizacion: 15,
        });
        score -= 15;
      }

      if (!client.rfc) {
        issues.push({
          code: "CLIENT_RFC_MISSING",
          etiqueta: "RFC faltante",
          descripcion: "No se capturó RFC para el cliente.",
          penalizacion: 10,
        });
        score -= 10;
      }

      if (!client.preferredContactMethod) {
        issues.push({
          code: "CLIENT_CONTACT_METHOD_MISSING",
          etiqueta: "Método de contacto faltante",
          descripcion: "No se indicó un medio de contacto preferido.",
          penalizacion: 10,
        });
        score -= 10;
      }

      const totalPolizas = client.policies.length;
      const polizasActivas = client.policies.filter((policy) => policy.status === "ACTIVE").length;
      const ingresosEstimados = client.policies.reduce(
        (sum, policy) => sum + toNumber(policy.premiumAmount),
        0,
      );

      if (totalPolizas === 0) {
        issues.push({
          code: "CLIENT_WITHOUT_POLICY",
          etiqueta: "Sin pólizas",
          descripcion: "El cliente no tiene pólizas registradas.",
          penalizacion: 15,
        });
        score -= 15;
      }

      const completitud = Math.max(
        0,
        Math.round(
          ((Number(Boolean(client.email)) +
            Number(Boolean(client.phone || client.secondaryPhone)) +
            Number(Boolean(client.address)) +
            Number(Boolean(client.rfc)) +
            Number(Boolean(client.preferredContactMethod))) /
            5) *
            100,
        ),
      );

      return {
        clienteId: client.id,
        cliente: client.fullName,
        score: clampScore(score),
        nivel: qualityLevel(score),
        completitud,
        totalPolizas,
        polizasActivas,
        ingresosEstimados,
        issues,
      };
    })
    .sort((a, b) => a.score - b.score || a.cliente.localeCompare(b.cliente));
}

export async function getPolicyDataQualityScores() {
  const db = getDb();
  const policies = await db.policy.findMany({
    select: {
      id: true,
      policyNumber: true,
      status: true,
      insuredObject: true,
      premiumAmount: true,
      clientId: true,
      client: { select: { fullName: true } },
      insurer: { select: { name: true } },
      documents: {
        select: {
          documentType: true,
        },
      },
    },
  });

  return policies
    .map<PolicyQualityScore>((policy) => {
      const issues: DataQualityIssue[] = [];
      let score = 100;

      const hasPolicyPdf = policy.documents.some((document) => document.documentType === "POLICY");
      if (!hasPolicyPdf) {
        issues.push({
          code: "POLICY_PDF_MISSING",
          etiqueta: "PDF faltante",
          descripcion: "No existe documento principal de póliza.",
          penalizacion: 20,
        });
        score -= 20;
      }

      if (!policy.insuredObject) {
        issues.push({
          code: "POLICY_OBJECT_MISSING",
          etiqueta: "Objeto asegurado faltante",
          descripcion: "La póliza no describe el objeto asegurado.",
          penalizacion: 15,
        });
        score -= 15;
      }

      if (policy.status === "PENDING") {
        issues.push({
          code: "POLICY_PENDING",
          etiqueta: "Póliza pendiente",
          descripcion: "La póliza sigue en estado pendiente.",
          penalizacion: 10,
        });
        score -= 10;
      }

      if (!toNumber(policy.premiumAmount)) {
        issues.push({
          code: "POLICY_PREMIUM_MISSING",
          etiqueta: "Prima faltante",
          descripcion: "La póliza no tiene prima capturada.",
          penalizacion: 15,
        });
        score -= 15;
      }

      const completitud = Math.max(
        0,
        Math.round(
          ((Number(hasPolicyPdf) +
            Number(Boolean(policy.insuredObject)) +
            Number(Boolean(toNumber(policy.premiumAmount)))) /
            3) *
            100,
        ),
      );

      return {
        polizaId: policy.id,
        poliza: policy.policyNumber,
        clienteId: policy.clientId,
        cliente: policy.client.fullName,
        aseguradora: policy.insurer.name,
        score: clampScore(score),
        nivel: qualityLevel(score),
        completitud,
        issues,
      };
    })
    .sort((a, b) => a.score - b.score || a.poliza.localeCompare(b.poliza));
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function qualityLevel(score: number): ClientQualityScore["nivel"] {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bueno";
  if (score >= 50) return "Atención";
  return "Crítico";
}
