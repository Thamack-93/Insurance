"use client";

import { useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/lib/settings";
import type { MutationResult } from "@/lib/mutation-utils";

type SettingsFormProps = {
  initialSettings: Settings;
  updateSettings: (settings: Partial<Settings>) => Promise<MutationResult>;
};

const fieldHint = "text-xs text-muted-foreground";

export function SettingsForm({ initialSettings, updateSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const { setTheme } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      const result = await updateSettings(settings);
      if (result.ok) {
        // Sync next-themes with the persisted preference so the toggle stays consistent.
        if (settings.theme === "dark" || settings.theme === "light") {
          setTheme(settings.theme);
        }
        toast.success(result.message);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleChange = (key: keyof Settings, value: string | boolean | number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Firma Section */}
      <Card>
        <CardHeader>
          <CardTitle>Datos de la firma</CardTitle>
          <CardDescription>Información que aparecerá en documentos y reportes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firmName">Nombre de la firma</Label>
              <Input
                id="firmName"
                value={settings.firmName}
                onChange={(e) => handleChange("firmName", e.target.value)}
                placeholder="PG"
              />
              <p className={fieldHint}>Aparece en el sidebar y en los reportes exportados.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="firmRfc">RFC</Label>
              <Input
                id="firmRfc"
                value={settings.firmRfc}
                onChange={(e) => handleChange("firmRfc", e.target.value)}
                placeholder="XAXX010101000"
              />
              <p className={fieldHint}>Se incluye en los datos fiscales de la firma.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firmEmail">Email</Label>
              <Input
                id="firmEmail"
                type="email"
                value={settings.firmEmail}
                onChange={(e) => handleChange("firmEmail", e.target.value)}
                placeholder="contacto@ejemplo.com"
              />
              <p className={fieldHint}>Contacto principal para clientes y aseguradoras.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="firmPhone">Teléfono</Label>
              <Input
                id="firmPhone"
                value={settings.firmPhone}
                onChange={(e) => handleChange("firmPhone", e.target.value)}
                placeholder="+52 55 1234 5678"
              />
              <p className={fieldHint}>Visible en cabeceras de reportes y comunicaciones.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="firmAddress">Dirección</Label>
            <Input
              id="firmAddress"
              value={settings.firmAddress}
              onChange={(e) => handleChange("firmAddress", e.target.value)}
              placeholder="Calle, número, ciudad, código postal"
            />
            <p className={fieldHint}>Domicilio fiscal para documentos oficiales.</p>
          </div>
        </CardContent>
      </Card>

      {/* Preferences Section */}
      <Card>
        <CardHeader>
          <CardTitle>Preferencias</CardTitle>
          <CardDescription>Configuración general del sistema</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultCurrency">Moneda por defecto</Label>
              <Select
                items={{ MXN: "MXN - Peso Mexicano", USD: "USD - Dólar Americano" }}
                value={settings.defaultCurrency}
                onValueChange={(value) => handleChange("defaultCurrency", value ?? "MXN")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN - Peso Mexicano</SelectItem>
                  <SelectItem value="USD">USD - Dólar Americano</SelectItem>
                </SelectContent>
              </Select>
              <p className={fieldHint}>
                Se aplica al mostrar montos cuando una póliza o recibo no especifica su propia moneda.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateFormat">Formato de fecha</Label>
              <Select
                items={{
                  "DD/MM/YYYY": "DD/MM/YYYY",
                  "MM/DD/YYYY": "MM/DD/YYYY",
                  "YYYY-MM-DD": "YYYY-MM-DD",
                }}
                value={settings.dateFormat}
                onValueChange={(value) => handleChange("dateFormat", value ?? "DD/MM/YYYY")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
              <p className={fieldHint}>
                Define cómo se renderiza cualquier fecha en listas, detalles y reportes.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="theme">Tema</Label>
            <Select
              items={{ light: "Claro", dark: "Oscuro" }}
              value={settings.theme}
              onValueChange={(value) => handleChange("theme", value ?? "light")}
            >
              <SelectTrigger className="md:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Claro</SelectItem>
                <SelectItem value="dark">Oscuro</SelectItem>
              </SelectContent>
            </Select>
            <p className={fieldHint}>
              Se aplica de inmediato al guardar y se recuerda entre sesiones.
            </p>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 opacity-70">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label>Notificaciones por email</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
                        Próximamente
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Requiere configurar un proveedor de email.</TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-sm text-muted-foreground">
                  Recibir alertas de vencimientos y eventos por correo.
                </p>
              </div>
              <Checkbox checked={settings.emailNotifications} disabled />
            </div>
            <div className="flex items-center justify-between gap-4 opacity-70">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label>Notificaciones por SMS</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
                        Próximamente
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Requiere configurar un proveedor de SMS.</TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-sm text-muted-foreground">
                  Avisos de texto a tu celular para recibos críticos.
                </p>
              </div>
              <Checkbox checked={settings.smsNotifications} disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backup Section */}
      <Card>
        <CardHeader>
          <CardTitle>Política de respaldos</CardTitle>
          <CardDescription>Cadencia obligatoria de recuperación</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="font-medium text-foreground">Organizaciones · diario</p>
            <p className="mt-1">Cada organización activa recibe un respaldo en la ejecución diaria de las 05:00 UTC.</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="font-medium text-foreground">Plataforma · semanal</p>
            <p className="mt-1">El respaldo global se crea cada siete días y conserva 30 días de historial físico verificado.</p>
          </div>
          <p className="md:col-span-2">Los valores históricos autoBackup y backupFrequency se conservan temporalmente por compatibilidad, pero ya no controlan el scheduler.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando..." : "Guardar configuración"}
        </Button>
      </div>
    </form>
  );
}
