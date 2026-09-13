export class OptimisticConcurrencyError extends Error {
  entity: string;
  expectedVersion: number;
  constructor(entity: string, expectedVersion: number) {
    super(`${entity} cambió mientras la editabas. Recarga los datos antes de guardar.`);
    this.name = "OptimisticConcurrencyError";
    this.entity = entity;
    this.expectedVersion = expectedVersion;
  }
}

export function versionedWhere<T extends Record<string, unknown>>(where: T, expectedVersion?: number) {
  return expectedVersion === undefined ? where : { ...where, version: expectedVersion };
}

export function nextVersion(version: number) {
  return version + 1;
}
