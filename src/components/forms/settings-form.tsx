"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/lib/settings";

type SettingsFormProps = {
  initialSettings: Settings;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;
};

export function SettingsForm({ initialSettings, updateSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    startTransition(async () => {
      try {
        await updateSettings(settings);
        toast.success("Configuración guardada exitosamente");
      } catch (error) {
        toast.error("Error al guardar la configuración");
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="firmRfc">RFC</Label>
              <Input
                id="firmRfc"
                value={settings.firmRfc}
                onChange={(e) => handleChange("firmRfc", e.target.value)}
                placeholder="XAXX010101000"
              />
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="firmPhone">Teléfono</Label>
              <Input
                id="firmPhone"
                value={settings.firmPhone}
                onChange={(e) => handleChange("firmPhone", e.target.value)}
                placeholder="+52 55 1234 5678"
              />
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateFormat">Formato de fecha</Label>
              <Select
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
            </div>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Notificaciones por email</Label>
                <p className="text-sm text-muted-foreground">Recibir alertas de vencimientos y eventos</p>
              </div>
              <Checkbox
                checked={settings.emailNotifications}
                onCheckedChange={(checked: boolean) => handleChange("emailNotifications", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Notificaciones por SMS</Label>
                <p className="text-sm text-muted-foreground">Recibir alertas de texto (requiere configuración)</p>
              </div>
              <Checkbox
                checked={settings.smsNotifications}
                onCheckedChange={(checked: boolean) => handleChange("smsNotifications", checked)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backup Section */}
      <Card>
        <CardHeader>
          <CardTitle>Respaldo automático</CardTitle>
          <CardDescription>Configuración de copias de seguridad</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Respaldo automático</Label>
              <p className="text-sm text-muted-foreground">Crear copias de seguridad periódicamente</p>
            </div>
            <Checkbox
              checked={settings.autoBackup}
              onCheckedChange={(checked: boolean) => handleChange("autoBackup", checked)}
            />
          </div>
          {settings.autoBackup && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="backupFrequency">Frecuencia</Label>
                  <Select
                    value={settings.backupFrequency}
                    onValueChange={(value) => handleChange("backupFrequency", value ?? "weekly")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diario</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retentionDays">Retención (días)</Label>
                  <Input
                    id="retentionDays"
                    type="number"
                    value={settings.retentionDays}
                    onChange={(e) => handleChange("retentionDays", parseInt(e.target.value))}
                    min={1}
                    max={365}
                  />
                </div>
              </div>
            </>
          )}
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
