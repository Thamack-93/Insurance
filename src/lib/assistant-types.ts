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
