import { redirect } from "next/navigation";
import { buildCanonicalHref } from "@/lib/navigation-redirects";

export default async function LegacyDuePaymentsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(buildCanonicalHref("/receipts", (await searchParams) ?? {}, { tab: "cobrar" }));
}
