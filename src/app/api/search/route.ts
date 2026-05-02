import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || !query.trim()) {
    return NextResponse.json([]);
  }

  try {
    const db = getDb();
    const results: any[] = [];

    // Search clients
    const clients = await db.client.findMany({
      where: {
        OR: [
          { fullName: { contains: query } },
          { email: { contains: query } },
          { phone: { contains: query } },
          { rfc: { contains: query } },
        ],
      },
      take: 5,
    });

    clients.forEach((client) => {
      results.push({
        id: client.id,
        type: "client",
        title: client.fullName,
        subtitle: client.email || client.phone || "Sin contacto",
        href: `/clients/${client.id}`,
        data: client,
      });
    });

    // Search policies
    const policies = await db.policy.findMany({
      where: {
        OR: [
          { policyNumber: { contains: query } },
          { insuredObject: { contains: query } },
        ],
      },
      include: { client: true },
      take: 5,
    });

    policies.forEach((policy) => {
      results.push({
        id: policy.id,
        type: "policy",
        title: policy.policyNumber,
        subtitle: `${policy.client.fullName} · ${policy.policyType}`,
        href: `/policies/${policy.id}`,
        data: policy,
      });
    });

    // Search receipts
    const receipts = await db.receipt.findMany({
      where: {
        OR: [{ receiptNumber: { contains: query } }],
      },
      include: { policy: { include: { client: true } } },
      take: 5,
    });

    receipts.forEach((receipt) => {
      results.push({
        id: receipt.id,
        type: "receipt",
        title: receipt.receiptNumber,
        subtitle: `${receipt.policy?.client.fullName || "Sin cliente"} · ${receipt.status}`,
        href: `/receipts/${receipt.id}`,
        data: receipt,
      });
    });

    // Search tasks
    const tasks = await db.task.findMany({
      where: {
        OR: [
          { title: { contains: query } },
          { folio: { contains: query } },
        ],
      },
      include: { client: true },
      take: 5,
    });

    tasks.forEach((task) => {
      results.push({
        id: task.id,
        type: "task",
        title: task.title,
        subtitle: `${task.client?.fullName || "Sin cliente"} · ${task.status}`,
        href: `/tasks/${task.id}`,
        data: task,
      });
    });

    // Search claims
    const claims = await db.claim.findMany({
      where: {
        OR: [
          { folio: { contains: query } },
          { claimType: { contains: query } },
        ],
      },
      include: { client: true },
      take: 5,
    });

    claims.forEach((claim) => {
      results.push({
        id: claim.id,
        type: "claim",
        title: claim.folio,
        subtitle: `${claim.client.fullName} · ${claim.claimType}`,
        href: `/claims/${claim.id}`,
        data: claim,
      });
    });

    // Search quotes
    const quotes = await db.quote.findMany({
      where: {
        OR: [{ id: { contains: query } }],
      },
      include: { client: true },
      take: 5,
    });

    quotes.forEach((quote) => {
      results.push({
        id: quote.id,
        type: "quote",
        title: quote.id.slice(0, 8),
        subtitle: `${quote.client.fullName} · ${quote.policyType}`,
        href: `/quotes/${quote.id}`,
        data: quote,
      });
    });

    // Search insurers
    const insurers = await db.insurer.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { contactName: { contains: query } },
        ],
      },
      take: 5,
    });

    insurers.forEach((insurer) => {
      results.push({
        id: insurer.id,
        type: "insurer",
        title: insurer.name,
        subtitle: insurer.contactName || "Sin contacto",
        href: `/insurers/${insurer.id}`,
        data: insurer,
      });
    });

    return NextResponse.json(results);
  } catch (error) {
    logError("api.search", error, { query });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
