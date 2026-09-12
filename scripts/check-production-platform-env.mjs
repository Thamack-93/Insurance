const isProductionRelease =
  process.env.VERCEL_ENV === "production" ||
  process.env.RELEASE_ENVIRONMENT === "production";

if (!isProductionRelease) {
  console.log("Production platform environment check skipped outside Production.");
  process.exit(0);
}

if (process.env.PLATFORM_TELEGRAM_ENABLED?.trim() !== "1") {
  throw new Error(
    "PRODUCTION_PLATFORM_ENV_INVALID: PLATFORM_TELEGRAM_ENABLED must be 1 in Production",
  );
}

console.log("Production platform environment check passed: Telegram is enabled.");
