import { GENERAL_INSURANCE_GUIDE } from "../src/lib/knowledge-base-general.ts";
import { seedGeneralKnowledgeSource } from "../src/lib/knowledge-base.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio para sembrar la guía general.");

const result = await seedGeneralKnowledgeSource(GENERAL_INSURANCE_GUIDE);
console.log(`General knowledge source ready: ${result.id} (${result.version})`);
