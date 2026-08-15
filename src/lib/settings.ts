"use server";

import { getDb } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
import { setRuntimeSettings, THEME_COOKIE } from "@/lib/settings-runtime";
import { AuthError, requireSuperAdmin, requireUser } from "@/lib/auth";

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
    const merged: Settings = {
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
    setRuntimeSettings(merged);
    return merged;
  } catch (error) {
    // If table doesn't exist yet, return defaults so the UI keeps working.
    logError("settings.getSettings", error);
    setRuntimeSettings(defaultSettings);
    return defaultSettings;
  }
}

/** Per-user theme preference (any role). Does not change firm-wide settings. */
export async function updateUserTheme(theme: string): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const cookieStore = await cookies();
    cookieStore.set(THEME_COOKIE, theme, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });

    const db = getDb();
    await db.systemSetting.upsert({
      where: { key: `theme:${user.id}` },
      update: { value: theme },
      create: { key: `theme:${user.id}`, value: theme },
    });

    return successResult("", "", "Tema guardado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.updateUserTheme", error);
    return errorResult("No se pudo guardar el tema.");
  }
}

export async function updateSettings(settings: Partial<Settings>): Promise<MutationResult> {
  const db = getDb();

  try {
    await requireSuperAdmin();
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

    setRuntimeSettings(settings);

    if (typeof settings.theme === "string") {
      const cookieStore = await cookies();
      cookieStore.set(THEME_COOKIE, settings.theme, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }

    revalidatePath("/", "layout");
    return successResult("", "/settings", "Configuración guardada.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.updateSettings", error);
    return errorResult(
      "No se pudo guardar la configuración. Verifica la conexión a la base de datos.",
    );
  }
}
