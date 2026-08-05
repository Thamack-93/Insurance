import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireUserOrRedirect } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";

export default async function NewEndorsementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUserOrRedirect();
  await requireOrganizationContext();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="CRM" title="Nuevo endoso" description="Las mutaciones de póliza requieren la siguiente slice tenant-aware." />
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader><CardTitle>Mutación temporalmente bloqueada</CardTitle><CardDescription>El endoso permanece disponible en modo lectura.</CardDescription></CardHeader>
        <CardContent><Button asChild variant="outline"><Link href={`/policies/${id}`}>Volver a la póliza</Link></Button></CardContent>
      </Card>
    </div>
  );
}
