"use server";

import { getDb } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";

export type Settings = {
  firmName: string;
  firmEmail: string;
  firmPhone: string;
  firmAddress: string;
  firmRfc: string;
  defaultCurrency: string;
  dateFormat: string;
  theme: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
  autoBackup: boolean;
  backupFrequency: string;
  retentionDays: number;
};

const defaultSettings: Settings = {
  firmName: "PG",
  firmEmail: "",
  firmPhone: "",
  firmAddress: "",
  firmRfc: "",
  defaultCurrency: "MXN",
  dateFormat: "DD/MM/YYYY",
  theme: "light",
  emailNotifications: true,
  smsNotifications: false,
  autoBackup: false,
  backupFrequency: "weekly",
  retentionDays: 30,
};

export async function getSettings(): Promise<Settings> {
  const db = getDb();
  
  try {
    // Get all settings from database
    const dbSettings = await db.systemSetting.findMany();
    
    // Convert to object
    const settingsMap = dbSettings.reduce<Record<string, string>>((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
    
    // Merge with defaults
    return {
      firmName: settingsMap.firmName ?? defaultSettings.firmName,
      firmEmail: settingsMap.firmEmail ?? defaultSettings.firmEmail,
      firmPhone: settingsMap.firmPhone ?? defaultSettings.firmPhone,
      firmAddress: settingsMap.firmAddress ?? defaultSettings.firmAddress,
      firmRfc: settingsMap.firmRfc ?? defaultSettings.firmRfc,
      defaultCurrency: settingsMap.defaultCurrency ?? defaultSettings.defaultCurrency,
      dateFormat: settingsMap.dateFormat ?? defaultSettings.dateFormat,
      theme: settingsMap.theme ?? defaultSettings.theme,
      emailNotifications: settingsMap.emailNotifications === "true",
      smsNotifications: settingsMap.smsNotifications === "true",
      autoBackup: settingsMap.autoBackup === "true",
      backupFrequency: settingsMap.backupFrequency ?? defaultSettings.backupFrequency,
      retentionDays: parseInt(settingsMap.retentionDays ?? String(defaultSettings.retentionDays)),
    };
  } catch (error) {
    // If table doesn't exist yet, return defaults so the UI keeps working.
    logError("settings.getSettings", error);
    return defaultSettings;
  }
}

export async function updateSettings(settings: Partial<Settings>): Promise<MutationResult> {
  const db = getDb();

  try {
    const entries = Object.entries(settings);
    await Promise.all(
      entries.map(([key, value]) => {
        const stringValue = String(value);
        return db.systemSetting.upsert({
          where: { key },
          update: { value: stringValue },
          create: { key, value: stringValue },
        });
      }),
    );

    revalidatePath("/settings");
    return successResult("", "/settings", "Configuración guardada.");
  } catch (error) {
    logError("settings.updateSettings", error);
    return errorResult(
      "No se pudo guardar la configuración. Verifica la conexión a la base de datos.",
    );
  }
}
