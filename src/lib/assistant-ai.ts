import "server-only";

import { gateway, generateText } from "ai";
import { z } from "zod";
import type { AssistantPrompt, AssistantReply, AssistantUser } from "@/lib/assistant-types";
import type { PolicyPdfCaptureDraft } from "@/lib/policy-pdf-capture.shared";

const aiQuickPromptSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
});

const assistantAiResponseSchema = z.object({
  reply: z.string().min(1),
  quickPrompts: z.array(aiQuickPromptSchema).max(4).default([]),
});

const pdfReviewSchema = z.object({
  summary: z.string().min(1),
  warnings: z.array(z.string().min(1)).default([]),
  suggestions: z.array(z.string().min(1)).default([]),
});

function hasGatewayAuth() {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

function toAssistantPrompts(prompts: Array<{ label: string; prompt: string }>): AssistantPrompt[] {
  return prompts.slice(0, 4).map((prompt) => ({ label: prompt.label, prompt: prompt.prompt }));
}

function serializeSections(sections: AssistantReply["sections"]) {
  return sections
    .map((section) => {
      const items = section.items
        .slice(0, 4)
        .map((item) => `- ${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""}${item.meta ? ` · ${item.meta}` : ""}`)
        .join("\n");
      return `${section.title}\n${section.summary}\n${items}`.trim();
    })
    .join("\n\n");
}

function parseJsonResponse<T>(text: string, schema: z.ZodType<T>): T | null {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```") ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim() : trimmed;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function buildAssistantAiReply(input: {
  user: AssistantUser;
  message: string;
  localReply: AssistantReply;
  themeHint?: string | null;
}): Promise<AssistantReply | null> {
  if (!hasGatewayAuth()) {
    return null;
  }

  try {
    const result = await generateText({
      model: gateway("openai/gpt-5.4"),
      temperature: 0.2,
      prompt: [
        "Eres el asistente de una app de seguros y correduría.",
        "Responde en español, con tono claro y operativo.",
        "Si la petición es ambigua o compleja, ayuda a desambiguar, pero no inventes datos.",
        "Devuelve SOLO JSON válido con la forma: {\"reply\": string, \"quickPrompts\": [{\"label\": string, \"prompt\": string}] }.",
        `Usuario: ${input.user.role}`,
        `Mensaje: ${input.message}`,
        `Contexto local:\n${serializeSections(input.localReply.sections) || "Sin secciones locales."}`,
        `Respuesta local sugerida: ${input.localReply.reply}`,
        input.themeHint ? `Tema sugerido: ${input.themeHint}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      providerOptions: {
        gateway: {
          user: input.user.id,
          tags: ["feature:assistant", `role:${input.user.role}`, "surface:web"],
        },
      },
    });

    const parsed = parseJsonResponse(result.text, assistantAiResponseSchema);
    if (!parsed) {
      return null;
    }

    return {
      reply: parsed.reply,
      sections: input.localReply.sections,
      quickPrompts: parsed.quickPrompts.length > 0 ? toAssistantPrompts(parsed.quickPrompts) : input.localReply.quickPrompts,
    };
  } catch {
    return null;
  }
}

export async function reviewPolicyPdfWithAi(input: {
  user: AssistantUser;
  text?: string | null;
  draft: PolicyPdfCaptureDraft;
  warnings: string[];
  themeHint?: string | null;
}): Promise<{ summary: string; warnings: string[]; suggestions: string[] } | null> {
  if (!hasGatewayAuth()) {
    return null;
  }

  try {
    const result = await generateText({
      model: gateway("openai/gpt-5.4"),
      temperature: 0.1,
      prompt: [
        "Eres un revisor experto de carátulas de pólizas de seguro.",
        "Tu trabajo es detectar dudas, inconsistencias y campos probablemente erróneos.",
        "No confirmes nada por tu cuenta: solo sugiere observaciones para revisión humana.",
        "Devuelve SOLO JSON válido con la forma: {\"summary\": string, \"warnings\": string[], \"suggestions\": string[] }.",
        `Tipo de usuario: ${input.user.role}`,
        `Tema: ${input.themeHint ?? "policy-pdf-review"}`,
        `Número de póliza detectado: ${input.draft.policyNumber}`,
        `Cliente detectado: ${input.draft.clientName}`,
        `Aseguradora detectada: ${input.draft.insurerName}`,
        `Tipo de póliza: ${input.draft.policyType}`,
        `Serie: ${input.draft.serialNumber ?? "sin serie"}`,
        `Inicio: ${input.draft.startDate}`,
        `Fin: ${input.draft.endDate}`,
        `Frecuencia: ${input.draft.paymentFrequency}`,
        `Prima: ${input.draft.premiumAmount}`,
        `Advertencias locales:\n${input.warnings.length ? input.warnings.map((warning) => `- ${warning}`).join("\n") : "- Sin advertencias"}`,
        input.text
          ? `Texto extraído:\n${input.text.slice(0, 12000)}`
          : "No hay texto extraído completo; revisa solo el borrador y las advertencias locales.",
      ].join("\n\n"),
      providerOptions: {
        gateway: {
          user: input.user.id,
          tags: ["feature:assistant", "feature:pdf-review", `role:${input.user.role}`],
        },
      },
    });

    const parsed = parseJsonResponse(result.text, pdfReviewSchema);
    if (!parsed) {
      return null;
    }

    return {
      summary: parsed.summary,
      warnings: parsed.warnings,
      suggestions: parsed.suggestions,
    };
  } catch {
    return null;
  }
}
