export type AssistantPrompt = {
  label: string;
  prompt: string;
};

export type AssistantSummaryCard = {
  label: string;
  value: string;
  description: string;
  href: string;
};

export type AssistantListItem = {
  title: string;
  subtitle: string;
  href: string;
  meta?: string;
};

export type AssistantSection = {
  title: string;
  summary: string;
  items: AssistantListItem[];
};

export type AssistantTodayBrief = AssistantSection & {
  metrics: {
    dueTodayCount: number;
    overdueCount: number;
    due7Count: number;
    renewals30Count: number;
    openWorkItemsCount: number;
    commissionsCount: number;
  };
};

export type AssistantSnapshot = {
  scopeLabel: string;
  welcome: string;
  summaryCards: AssistantSummaryCard[];
  sections: AssistantSection[];
  quickPrompts: AssistantPrompt[];
};

export type AssistantReply = {
  reply: string;
  sections: AssistantSection[];
  quickPrompts: AssistantPrompt[];
};

export type AssistantUser = {
  id: string;
  role: "ADMIN" | "AGENT";
};

export type AssistantResponseSource = "local" | "ai";

export type AssistantReportKind = "INCIDENT" | "SUGGESTION";

export type AssistantReportStatus = "COLLECTING" | "OPEN" | "RESOLVED" | "ARCHIVED" | "DELETED";

export type AssistantReportSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AssistantReportSnapshot = {
  id: string;
  kind: AssistantReportKind;
  themeKey: string;
  themeLabel: string;
  status: AssistantReportStatus;
  version: number;
  parentReportId: string | null;
  title: string;
  summary: string;
  recommendation: string;
  plan: string;
  signalCount: number;
  severity: AssistantReportSeverity;
  firstSignalAt: string;
  lastSignalAt: string;
  openedAt: string | null;
  resolvedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssistantConversationResponse = AssistantReply & {
  source: AssistantResponseSource;
  reportId: string | null;
  reportThemeKey: string | null;
  reportThemeLabel: string | null;
};
