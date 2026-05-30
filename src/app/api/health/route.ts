import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    await db.$queryRaw(Prisma.sql`select 1`);
    return NextResponse.json({
      ok: true,
      service: "policydesk",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logError("api.health", error);
    return NextResponse.json(
      {
        ok: false,
        service: "policydesk",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
