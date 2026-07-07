export function buildPolicyDeleteBlockedMessage(paidReceiptCount: number) {
  if (!Number.isFinite(paidReceiptCount) || paidReceiptCount <= 0) {
    return null;
  }

  const receiptLabel = paidReceiptCount === 1 ? "recibo pagado" : "recibos pagados";
  const despagarLabel = paidReceiptCount === 1 ? "despagarlo" : "despagarlos";

  return `No se puede eliminar: la póliza tiene ${paidReceiptCount} ${receiptLabel}. Elimina primero los pagos desde el detalle del recibo para poder ${despagarLabel} antes de borrar la póliza.`;
}
