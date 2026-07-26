import { redirect } from "next/navigation";
import { buildCanonicalHref } from "@/lib/navigation-redirects";

export default async function LegacyClaimsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(buildCanonicalHref("/operations", (await searchParams) ?? {}, { view: "claims" }));
}
