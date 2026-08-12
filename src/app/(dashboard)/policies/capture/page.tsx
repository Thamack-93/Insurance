import { ArrowLeftRight } from "@/components/icons";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { PolicyPdfCapturePanel } from "@/components/policies/policy-pdf-capture-panel";
import { requireUserOrRedirect } from "@/lib/auth";

export default async function PolicyPdfCapturePage({ searchParams }: { searchParams?: Promise<{ handoffId?: string }> }) {
  const user = await requireUserOrRedirect();
  const params = (await searchParams) ?? {};
  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Capturar póliza desde PDF"
          description="Sube la carátula, revisa la sugerencia de renovación y confirma para crear la nueva vigencia."
          actions={
            <Button asChild variant="outline" className="bg-card/70">
              <Link href="/policies">
                <ArrowLeftRight className="mr-2 size-4" />
                Volver a pólizas
              </Link>
            </Button>
          }
        />

        <PolicyPdfCapturePanel userId={user.id} handoffId={params.handoffId} />
      </div>
    </div>
  );
}
