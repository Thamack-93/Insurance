export type DemoResetArguments = {
  organizationId?: string;
  requestId?: string;
  reason?: string;
  dryRun: boolean;
  help: boolean;
};

export function parseDemoResetArguments(argv: string[]): DemoResetArguments {
  function option(name: string) {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;

    const value = argv[index + 1]?.trim();
    return value && !value.startsWith("--") ? value : undefined;
  }

  return {
    organizationId: option("--organization-id"),
    requestId: option("--request-id"),
    reason: option("--reason"),
    dryRun: argv.includes("--dry-run"),
    help: argv.includes("--help"),
  };
}
