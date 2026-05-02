"use server";

import { getDb } from "@/lib/db";
import { revalidatePath } from "next/cache";

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
    // If table doesn't exist yet, return defaults
    console.warn("SystemSetting table not found, returning defaults");
    return defaultSettings;
  }
}

export async function updateSetting(key: keyof Settings, value: string | boolean | number): Promise<void> {
  const db = getDb();
  
  const stringValue = String(value);
  
  await db.systemSetting.upsert({
    where: { key },
    update: { value: stringValue },
    create: { key, value: stringValue },
  });
  
  revalidatePath("/settings");
}

export async function updateSettings(settings: Partial<Settings>): Promise<void> {
  const db = getDb();
  
  try {
    for (const [key, value] of Object.entries(settings)) {
      const stringValue = String(value);
      await db.systemSetting.upsert({
        where: { key },
        update: { value: stringValue },
        create: { key, value: stringValue },
      });
    }
    
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to update settings:", error);
    throw new Error("No se pudo guardar la configuración. La tabla de configuración no existe.");
  }
}
