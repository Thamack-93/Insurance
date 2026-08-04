import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getPlatformOverview } from "@/lib/platform-dashboard";
import { PlatformDashboard } from "@/components/platform/platform-dashboard";

export default async function PlatformPage() {
  await requireSuperAdminOrRedirect();
  const overview = await getPlatformOverview();
  return <PlatformDashboard overview={overview} />;
}
