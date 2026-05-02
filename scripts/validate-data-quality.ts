import { closeDb, createDb, ensureDataDirs, formatMoney, hasFlag, parseCliArgs } from "./_shared";
import { getClientDataQualityScores, getPolicyDataQualityScores } from "../src/lib/data-quality";
import { detectRisks } from "../src/lib/risk-engine";

async function main() {
  const args = parseCliArgs();
  const strict = hasFlag(args, "strict");
  await ensureDataDirs();
  const db = createDb();

  try {
    const [clientScores, policyScores, risks] = await Promise.all([
      getClientDataQualityScores(),
      getPolicyDataQualityScores(),
      detectRisks(),
    ]);

    const criticalClients = clientScores.filter((item) => item.nivel === "Crítico");
    const attentionClients = clientScores.filter((item) => item.nivel === "Atención");
    const criticalPolicies = policyScores.filter((item) => item.nivel === "Crítico");
    const attentionPolicies = policyScores.filter((item) => item.nivel === "Atención");

    console.log("Validacion de calidad de datos");
    console.log(`Clientes evaluados: ${clientScores.length}`);
    console.log(`Polizas evaluadas: ${policyScores.length}`);
    console.log(`Riesgos detectados: ${risks.length}`);
    console.log("");
    console.log(`Clientes criticos: ${criticalClients.length}`);
    console.log(`Clientes en atencion: ${attentionClients.length}`);
    console.log(`Polizas criticas: ${criticalPolicies.length}`);
    console.log(`Polizas en atencion: ${attentionPolicies.length}`);

    if (criticalClients.length) {
      console.log("");
      console.log("Clientes con menor calidad");
      console.table(
        criticalClients.slice(0, 10).map((client) => ({
          Cliente: client.cliente,
          Score: client.score,
          Polizas: client.totalPolizas,
          "Prima estimada": formatMoney(client.ingresosEstimados),
          Faltantes: client.issues.map((issue) => issue.etiqueta).join(", "),
        })),
      );
    }

    if (criticalPolicies.length) {
      console.log("");
      console.log("Polizas con menor calidad");
      console.table(
        criticalPolicies.slice(0, 10).map((policy) => ({
          Poliza: policy.poliza,
          Cliente: policy.cliente,
          Aseguradora: policy.aseguradora,
          Score: policy.score,
          Faltantes: policy.issues.map((issue) => issue.etiqueta).join(", "),
        })),
      );
    }

    if (strict && (criticalClients.length || criticalPolicies.length || risks.some((risk) => risk.severity === "CRITICAL"))) {
      process.exitCode = 1;
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error("Error al validar calidad de datos.");
  console.error(error);
  process.exit(1);
});
