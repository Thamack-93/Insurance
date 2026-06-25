export type ReceiptOriginLike = {
  endorsement?: {
    endorsementNumber: string;
  } | null;
};

export function getReceiptOriginLabel(receipt: ReceiptOriginLike) {
  return receipt.endorsement ? `Endoso ${receipt.endorsement.endorsementNumber}` : "Póliza base";
}

