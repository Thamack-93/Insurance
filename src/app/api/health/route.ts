import { NextResponse } from "next/server";
import { getDeploymentDatabaseSafety } from "@/lib/deployment-db-safety";

export async function GET() {
  const safety = await getDeploymentDatabaseSafety();
  return NextResponse.json(
    {
      ok: safety.safe,
      service: "policydesk",
      databaseSafety: safety.safe ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
    },
    {
      status: safety.safe ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
