import { revalidatePath } from "next/cache";

export type MutationResult =
  | {
      ok: true;
      id: string;
      redirectTo: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export function successResult(id: string, redirectTo: string, message: string): MutationResult {
  return { ok: true, id, redirectTo, message };
}

export function errorResult(error: string): MutationResult {
  return { ok: false, error };
}

export function revalidatePaths(paths: string[]) {
  for (const path of paths) {
    revalidatePath(path);
  }
}