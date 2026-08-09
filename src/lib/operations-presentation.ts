import { businessStartOfDay, businessToday } from "@/lib/business-dates";

export type OperationalPolicyContext = {
  status: string;
  endDate: Date | null;
};

export type OperationalRenewalState = "VENCIDA" | "URGENTE" | "PROXIMA" | "PENDIENTE";

export type OperationalWorkItemPresentation = {
  isRenewal: boolean;
  state: OperationalRenewalState | null;
  renewalLabel: "Venció" | "Renueva" | null;
  followUpPending: boolean;
  followUpOverdue: boolean;
};

function normalizeSearchText(value: string | null | undefined) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
}

export function buildOperationalWorkItemPresentation(input: {
  sourceType?: string | null;
  taskType?: string | null;
  title?: string | null;
  description?: string | null;
  dueDate?: Date | null;
  policy?: OperationalPolicyContext | null;
  now?: Date;
}): OperationalWorkItemPresentation {
  const sourceType = normalizeSearchText(input.sourceType);
  const taskType = normalizeSearchText(input.taskType);
  const text = normalizeSearchText(`${input.title ?? ""} ${input.description ?? ""}`);
  const isRenewal = sourceType === "renewal" || taskType === "renewal" || /\brenovacion\b/.test(text);
  const today = businessToday(input.now);
  const followUpOverdue = Boolean(input.dueDate && businessStartOfDay(input.dueDate) < today);

  if (!isRenewal) {
    return { isRenewal: false, state: null, renewalLabel: null, followUpPending: false, followUpOverdue };
  }

  if (!input.policy || input.policy.status !== "ACTIVE" || !input.policy.endDate) {
    return { isRenewal: true, state: "PENDIENTE", renewalLabel: null, followUpPending: true, followUpOverdue: false };
  }

  const renewalOverdue = businessStartOfDay(input.policy.endDate) < today;
  if (renewalOverdue) {
    return { isRenewal: true, state: "VENCIDA", renewalLabel: "Venció", followUpPending: false, followUpOverdue };
  }

  return {
    isRenewal: true,
    state: followUpOverdue ? "URGENTE" : "PROXIMA",
    renewalLabel: "Renueva",
    followUpPending: false,
    followUpOverdue,
  };
}
