export function getRemainingReceiptAmount(totalAmount: number, paidAmounts: number[]) {
  return Math.max(0, totalAmount - paidAmounts.reduce((sum, amount) => sum + amount, 0));
}

export function validatePaymentAgainstBalance(input: {
  amount: number;
  totalAmount: number;
  paidAmounts: number[];
  receiptStatus: string;
  currency: string;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "El monto del pago debe ser mayor a cero.";
  if (input.receiptStatus === "CANCELLED") return "No puedes aplicar pagos a un recibo cancelado.";
  const remainingAmount = getRemainingReceiptAmount(input.totalAmount, input.paidAmounts);
  if (remainingAmount <= 0.01 || input.receiptStatus === "PAID") return "Este recibo ya está pagado y no tiene saldo pendiente.";
  if (input.amount - remainingAmount > 0.01) return `El pago excede el saldo pendiente de ${remainingAmount.toFixed(2)} ${input.currency}.`;
  return null;
}
