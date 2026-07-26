import { redirect } from "next/navigation";
import { buildCanonicalHref } from "@/lib/navigation-redirects";

export default async function LegacyDashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(buildCanonicalHref("/today", (await searchParams) ?? {}, { view: "insights" }));
}
