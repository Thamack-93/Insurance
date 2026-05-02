import { backupDatabase } from "./_shared.ts";

async function main() {
  const backup = await backupDatabase();

  if (!backup) {
    console.log("No se encontro una base de datos para respaldar.");
    return;
  }

  console.log(`Backup creado correctamente en: ${backup}`);
}

main().catch((error) => {
  console.error("Error al crear el backup.");
  console.error(error);
  process.exit(1);
});
