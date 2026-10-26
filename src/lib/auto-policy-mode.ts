export type AutoPolicyMode = "INDIVIDUAL" | "FLOTILLA";

export function countInsuredVehicles(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((vehicle) => vehicle && typeof vehicle === "object" && Object.values(vehicle).some((field) => typeof field === "string" && field.trim())).length;
}

export function autoPolicyModeForCount(vehicleCount: number): AutoPolicyMode | "" {
  return vehicleCount === 1 ? "INDIVIDUAL" : vehicleCount > 1 ? "FLOTILLA" : "";
}
