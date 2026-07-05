import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";
import { writeActivityLog } from "@/lib/activity-log";
import { inferClientType } from "@/lib/policy-pdf-capture.shared";

export const runtime = "nodejs";

const createClientSchema = z.object({
  fullName: z.string().trim().min(2),
  type: z.enum(["PERSON", "COMPANY"]).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  rfc: z.string().trim().optional().or(z.literal("")),
});

function normalizeText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    let user: Awaited<ReturnType<typeof requireUser>>;
    try {
      user = await requireUser();
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    assertSameOrigin(request, "policy capture client create");
    const rateLimit = checkRateLimit(`policy-capture-client-create:${getRequestIp(request)}`, {
      limit: 20,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta de nuevo en un momento." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) },
        },
      );
    }

    const payload = createClientSchema.parse(await request.json());
    const db = getDb();
    const inferredType = payload.type ?? inferClientType(payload.fullName, normalizeText(payload.rfc));
    const rfc = normalizeText(payload.rfc)?.toUpperCase() ?? null;
    const email = normalizeText(payload.email);
    const phone = normalizeText(payload.phone);
    const address = normalizeText(payload.address);

    const existing = await db.client.findFirst({
      where: {
        status: { not: "ARCHIVED" },
        portfolioOwnerId: user.id,
        OR: [
          ...(rfc ? [{ rfc }] : []),
          {
            fullName: {
              equals: payload.fullName.trim(),
              mode: "insensitive" as const,
            },
          },
        ],
      },
      select: {
        id: true,
        fullName: true,
        type: true,
        email: true,
        phone: true,
        rfc: true,
        address: true,
      },
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        client: {
          id: existing.id,
          label: existing.fullName,
          type: existing.type,
          email: existing.email,
          phone: existing.phone,
          rfc: existing.rfc,
          address: existing.address,
          reused: true,
        },
      });
    }

    const client = await db.client.create({
      data: {
        fullName: payload.fullName.trim(),
        type: inferredType,
        email,
        phone,
        address,
        rfc,
        status: "ACTIVE",
        portfolioOwnerId: user.id,
        createdById: user.id,
        updatedById: user.id,
      },
      select: {
        id: true,
        fullName: true,
        type: true,
        email: true,
        phone: true,
        rfc: true,
        address: true,
      },
    });

    await writeActivityLog({
      entityType: "Client",
      entityId: client.id,
      action: "CLIENT_CREATE",
      newValue: client,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      client: {
        id: client.id,
        label: client.fullName,
        type: client.type,
        email: client.email,
        phone: client.phone,
        rfc: client.rfc,
        address: client.address,
        reused: false,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.policies.capture.clients", error);
    return NextResponse.json({ error: "No se pudo crear el cliente." }, { status: 500 });
  }
}
