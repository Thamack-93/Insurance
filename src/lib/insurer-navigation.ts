export function getInsurerHref(insurerId: string, isAdmin: boolean) {
  return isAdmin ? `/insurers/${insurerId}` : `/portfolio?insurerId=${encodeURIComponent(insurerId)}`;
}
