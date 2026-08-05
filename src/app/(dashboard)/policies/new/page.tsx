import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireUserOrRedirect } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";

export default async function NewPolicyPage() {
  await requireUserOrRedirect();
  await requireOrganizationContext();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="CRM" title="Nueva póliza" description="La creación de pólizas requiere la siguiente slice tenant-aware." />
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Mutación temporalmente bloqueada</CardTitle>
          <CardDescription>
            Esta PR mantiene la lectura de pólizas aislada, pero no habilita crear registros de póliza.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline"><Link href="/policies">Volver a pólizas</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
