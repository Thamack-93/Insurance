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
  ai: AssistantAiStatus;
  summaryCards: AssistantSummaryCard[];
  sections: AssistantSection[];
  quickPrompts: AssistantPrompt[];
};

export type AssistantAiStatus = {
  available: boolean;
  authMode: "api-key" | "oidc" | "deployment" | "unavailable";
  model: string;
  fallbackModels: string[];
};

export type AssistantAiTier = "deterministic" | "minimax" | "critical";
export type AssistantAiRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED";
export type AssistantAiAttemptStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export type AssistantAiUsageSnapshot = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  estimatedCostUsd: number | null;
};

export type AssistantAiAttempt = {
  model: string;
  code: AssistantAiFailureCode | null;
  outcome: "success" | "error";
  durationMs: number;
  statusCode?: number | null;
  finishReason?: string | null;
  responsePreview?: string | null;
};

export type AssistantAiTraceEntry = {
  attemptNumber: number;
  tier: AssistantAiTier;
  status: AssistantAiAttemptStatus;
  requestedModel: string;
  finalModel: string | null;
  fallbackReason: string | null;
  code: AssistantAiFailureCode | null;
  durationMs: number | null;
  finishReason: string | null;
  statusCode: number | null;
  usage: AssistantAiUsageSnapshot | null;
  responsePreview: string | null;
};

export type AssistantAiAttemptSnapshot = AssistantAiTraceEntry & {
  id: string;
  runId: string;
  provider: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssistantAiRunSnapshot = {
  id: string;
  userId: string;
  userRole: "ADMIN" | "AGENT";
  operation: AssistantAiOperation;
  tier: AssistantAiTier;
  requestedModel: string;
  finalModel: string | null;
  status: AssistantAiRunStatus;
  attemptCount: number;
  fallbackCount: number;
  fallbackReason: string | null;
  reportId: string | null;
  errorCode: AssistantAiFailureCode | null;
  errorMessage: string | null;
  statusCode: number | null;
  finishReason: string | null;
  usage: AssistantAiUsageSnapshot | null;
  totalUsage: AssistantAiUsageSnapshot | null;
  providerMetadata: unknown;
  responsePreview: string | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  attempts: AssistantAiAttemptSnapshot[];
};

export type AssistantAiOperation =
  | "assistant-reply"
  | "assistant-report-classification"
  | "policy-pdf-extract"
  | "policy-pdf-review";

export type AssistantAiFailureCode =
  | "unavailable"
  | "timeout"
  | "aborted"
  | "api_call_error"
  | "no_object_generated"
  | "no_output_generated"
  | "invalid_output"
  | "invalid_prompt"
  | "type_validation_error"
  | "empty_response"
  | "unknown";

export type AssistantAiDiagnostic = {
  diagnosticId: string;
  runId?: string | null;
  attemptNumber?: number | null;
  operation: AssistantAiOperation;
  tier?: AssistantAiTier | null;
  code: AssistantAiFailureCode;
  model: string;
  resolvedModel?: string | null;
  fallbackModels: string[];
  durationMs: number;
  summary: string;
  details: string;
  createdAt: string;
  statusCode?: number | null;
  finishReason?: string | null;
  responsePreview?: string | null;
  usage?: AssistantAiUsageSnapshot | null;
  attempts?: AssistantAiAttempt[];
  trace?: AssistantAiTraceEntry[];
  reportId?: string | null;
};

export type AssistantReply = {
  reply: string;
  sections: AssistantSection[];
  quickPrompts: AssistantPrompt[];
};

export type AssistantMutationEntityType = "client" | "policy" | "receipt" | "payment" | "task";
export type AssistantMutationOperation = "create" | "update";

export type AssistantMutationField = {
  field: string;
  label: string;
  value: string;
};

export type AssistantMutationRelation = {
  field: string;
  label: string;
  query: string;
};

export type AssistantMutationMissingField = {
  field: string;
  label: string;
  question: string;
};

export type AssistantMutationPlan = {
  entityType: AssistantMutationEntityType;
  operation: AssistantMutationOperation;
  targetQuery: string | null;
  title: string;
  summary: string;
  reply: string;
  fields: AssistantMutationField[];
  relations: AssistantMutationRelation[];
  missingFields: AssistantMutationMissingField[];
};

export type AssistantActionProposal = {
  draftId: string;
  entityType: AssistantMutationEntityType;
  operation: AssistantMutationOperation;
  title: string;
  summary: string;
  targetLabel: string | null;
  changes: Array<{
    label: string;
    before: string | null;
    after: string;
  }>;
  confirmLabel: string;
  expiresAt: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "local" | "ai";
  sections?: AssistantSection[];
  quickPrompts?: AssistantPrompt[];
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
  details: unknown;
  evidence: Array<{
    signalKind?: string;
    source?: string;
    title?: string;
    summary?: string;
    recommendation?: string;
    plan?: string;
    severity?: string;
    diagnostic?: {
      diagnosticId?: string;
      operation?: string;
      code?: string;
      model?: string;
      fallbackModels?: string[];
      durationMs?: number;
      summary?: string;
      details?: string;
      createdAt?: string;
      statusCode?: number | null;
      finishReason?: string | null;
      responsePreview?: string | null;
      reportId?: string | null;
    };
    input?: unknown;
    output?: unknown;
    evidence?: unknown;
    createdAt?: string;
  }>;
  signals: Array<{
    id: string;
    signalKind: string;
    source: string;
    title: string;
    createdAt: string;
  }>;
};

export type AssistantConversationResponse = AssistantReply & {
  source: AssistantResponseSource;
  reportId: string | null;
  reportThemeKey: string | null;
  reportThemeLabel: string | null;
  aiRunId?: string | null;
  aiTier?: AssistantAiTier | null;
  aiModel?: string | null;
  aiAttempts?: number;
  aiUsage?: AssistantAiUsageSnapshot | null;
  aiTrace?: AssistantAiTraceEntry[];
  aiFallbackNotice?: string | null;
  aiDiagnostic?: AssistantAiDiagnostic | null;
  actionProposal?: AssistantActionProposal | null;
};
