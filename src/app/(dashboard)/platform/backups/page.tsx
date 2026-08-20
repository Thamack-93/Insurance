import { redirect } from "next/navigation";
import { requireSuperAdminOrRedirect } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PlatformBackupsPage() {
  await requireSuperAdminOrRedirect();
  redirect("/platform");
}
