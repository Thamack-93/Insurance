import { notFound } from "next/navigation";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getPlatformOrganization, getPlatformPlans } from "@/lib/platform-dashboard";
import { PlatformOrganizationDetail } from "@/components/platform/platform-organization-detail";

export default async function PlatformOrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  await requireSuperAdminOrRedirect();
  const { organizationId } = await params;
  const [detail, plans] = await Promise.all([getPlatformOrganization(organizationId), getPlatformPlans()]);
  if (!detail) notFound();
  return <PlatformOrganizationDetail detail={detail} plans={plans} />;
}
