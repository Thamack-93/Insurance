import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { OrganizationCreateForm } from "@/components/platform/organization-create-form";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage() {
  await requireSuperAdminOrRedirect();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link href="/platform/organizations" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline"><ArrowLeft className="size-4" />Volver a organizaciones</Link>
      <header><p className="text-sm font-semibold text-muted-foreground">Plataforma</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Nueva organización</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Aprovisiona una organización independiente con su propietario inicial. La cuenta principal conserva acceso solo a metadatos y recuperación controlada.</p></header>
      <OrganizationCreateForm />
    </div>
  );
}
