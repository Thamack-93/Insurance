import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BellRing, Database, Globe2, Palette, ShieldCheck, ArrowRight } from "lucide-react";
import { today, formatDate } from "@/lib/dates";
import Link from "next/link";

export default async function SettingsPage() {
  const now = today();

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Sistema"
          title="Settings"
          description="Preferencias base de PolicyDesk para la fase temprana: operación local, idioma y calidad."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/reports">
                Ir a reportes
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Estado" value="Listo" description="Configuración base cargada para operar localmente." icon={ShieldCheck} tone="emerald" />
          <MetricCard title="Modo" value="Local-first" description="SQLite y archivos locales como base." icon={Database} tone="blue" />
          <MetricCard title="Idioma" value="Español" description="Textos, fechas y etiquetas localizadas." icon={Globe2} tone="amber" />
          <MetricCard title="Actualizado" value={formatDate(now)} description="Vista de referencia del sistema." icon={BellRing} tone="rose" />
        </section>

        <Tabs defaultValue="firma" className="w-full">
          <TabsList className="mb-4 flex w-full flex-wrap justify-start gap-2 rounded-2xl bg-transparent p-0">
            <TabsTrigger value="firma" className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 data-active:bg-stone-900 data-active:text-white">
              Firma
            </TabsTrigger>
            <TabsTrigger value="datos" className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 data-active:bg-stone-900 data-active:text-white">
              Datos locales
            </TabsTrigger>
            <TabsTrigger value="preferencias" className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 data-active:bg-stone-900 data-active:text-white">
              Preferencias
            </TabsTrigger>
            <TabsTrigger value="calidad" className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 data-active:bg-stone-900 data-active:text-white">
              Calidad
            </TabsTrigger>
          </TabsList>

          <TabsContent value="firma">
            <SectionCard title="Identidad de la operación" description="Datos de presentación y contacto visibles para el equipo.">
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="text-sm text-muted-foreground">Nombre de la firma</p>
                  <p className="mt-2 text-lg font-semibold">PolicyDesk</p>
                  <p className="mt-2 text-sm text-muted-foreground">Cockpit local para cartera, cobranza y calidad.</p>
                </div>
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="text-sm text-muted-foreground">Estado visual</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline" className="rounded-full">
                      Premium light
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      Operación local
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      Español
                    </Badge>
                  </div>
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="datos">
            <SectionCard title="Persistencia local" description="Lo que debe seguir estable en el MVP.">
              <div className="grid gap-4 p-4 md:grid-cols-3">
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="text-sm text-muted-foreground">Base de datos</p>
                  <p className="mt-2 font-semibold">SQLite local</p>
                </div>
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="text-sm text-muted-foreground">Carpeta sensible</p>
                  <p className="mt-2 font-semibold">`data/documents`</p>
                </div>
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="text-sm text-muted-foreground">Backup</p>
                  <p className="mt-2 font-semibold">Script manual disponible</p>
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="preferencias">
            <SectionCard title="Preferencias de interfaz" description="Decisiones de lectura para el equipo.">
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="rounded-2xl border bg-white/70 p-4">
                  <div className="flex items-center gap-3">
                    <Palette className="size-4 text-muted-foreground" />
                    <p className="font-medium">Tema</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Sobrio, claro y editorial. Sin gritos visuales.</p>
                </div>
                <div className="rounded-2xl border bg-white/70 p-4">
                  <div className="flex items-center gap-3">
                    <BellRing className="size-4 text-muted-foreground" />
                    <p className="font-medium">Alertas</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Usar avisos visibles para vencimientos y riesgos.</p>
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="calidad">
            <SectionCard title="Principios de calidad" description="Lo que no debería romperse antes de avanzar a Fase 2.">
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="font-medium">Nombres consistentes</p>
                  <p className="mt-2 text-sm text-muted-foreground">Clientes, pólizas y documentos deben llevar etiquetas claras.</p>
                </div>
                <div className="rounded-2xl border bg-white/70 p-4">
                  <p className="font-medium">Campos críticos visibles</p>
                  <p className="mt-2 text-sm text-muted-foreground">Estado, fechas, montos y relaciones nunca deben quedar ocultos.</p>
                </div>
              </div>
              <Separator className="my-4" />
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                Estas preferencias son de referencia temprana. Más adelante podrán vivir en un formulario persistido.
              </p>
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
