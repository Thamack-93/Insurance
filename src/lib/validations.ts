import { z } from "zod";

export const clientSchema = z.object({
  fullName: z.string().min(2, "Escribe el nombre del cliente."),
  email: z.string().email("Email invalido.").optional().or(z.literal("")),
  phone: z.string().optional(),
});

export const policySchema = z.object({
  policyNumber: z.string().min(2),
  clientId: z.string().min(1),
  insurerId: z.string().min(1),
  premiumAmount: z.coerce.number().positive(),
});

export const taskSchema = z.object({
  title: z.string().min(3),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
});

