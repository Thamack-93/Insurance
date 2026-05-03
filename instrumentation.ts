export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertSessionSecretAvailable } = await import("@/lib/session");
  assertSessionSecretAvailable();
}
