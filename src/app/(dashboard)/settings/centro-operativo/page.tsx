import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  ClipboardCheck,
  FileDigit,
  History,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/auth";

export const metadata = {
  title: "Centro Operativo · Administración",
};

const operationalLinks = [
  {
    title: "Aseguradoras",
    description: "Directorio de compañías, contactos y cartera vinculada.",
    href: "/insurers",
    icon: Building2,
  },
  {
    title: "Documentos",
    description: "Revisa archivos, asociaciones y expedientes incompletos.",
    href: "/documents",
    icon: FileDigit,
  },
  {
    title: "Riesgos",
    description: "Consulta alertas, hallazgos y prioridades de atención.",
    href: "/risks",
    icon: ShieldAlert,
  },
  {
    title: "Calidad de datos",
    description: "Audita vigencias, pagos, renovaciones y problemas de información.",
    href: "/data-quality",
    icon: ClipboardCheck,
  },
  {
    title: "Auditoría y seguridad",
    description: "Consulta la actividad y los eventos relevantes del sistema.",
    href: "/activity",
    icon: History,
  },
  {
    title: "Nora y reportes IA",
    description: "Revisa incidentes, evidencia y configuración del uso de IA.",
    href: "/settings/assistant",
    icon: Sparkles,
  },
] as const;

export default async function OperationalCenterPage() {
  await requireAdminOrRedirect();

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Administración"
          title="Centro Operativo"
          description="Accesos directos a las herramientas internas de supervisión y mantenimiento de PolicyDesk."
          actions={
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/settings">
                Volver a configuración
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section aria-label="Herramientas internas" className="grid gap-4 sm:grid-cols-2">
          {operationalLinks.map(({ title, description, href, icon: Icon }) => (
            <Card key={href} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-primary" aria-hidden />
                  {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild variant="outline" className="rounded-full">
                  <Link href={href}>
                    Abrir sección
                    <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4" aria-hidden />
              Vistas operativas principales
            </CardTitle>
            <CardDescription>
              Pólizas, Cotizaciones, Cartera, Operación y Nora contextual permanecen en sus accesos habituales.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
