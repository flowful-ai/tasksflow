import { z } from 'zod';

/** Events an outgoing webhook can subscribe to. `*` subscribes to all of them. */
export const OUTGOING_WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'task.restored',
  'comment.created',
] as const;
export const OutgoingWebhookEventSchema = z.enum(OUTGOING_WEBHOOK_EVENTS);
export type OutgoingWebhookEvent = z.infer<typeof OutgoingWebhookEventSchema>;

export const OutgoingWebhookEventSelectorSchema = z.union([OutgoingWebhookEventSchema, z.literal('*')]);

export const CreateOutgoingWebhookSchema = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().url().max(2048),
  description: z.string().max(500).optional(),
  events: z.array(OutgoingWebhookEventSelectorSchema).min(1).max(OUTGOING_WEBHOOK_EVENTS.length + 1),
  enabled: z.boolean().optional(),
});
export type CreateOutgoingWebhook = z.infer<typeof CreateOutgoingWebhookSchema>;

export const UpdateOutgoingWebhookSchema = z.object({
  url: z.string().url().max(2048).optional(),
  description: z.string().max(500).nullable().optional(),
  events: z.array(OutgoingWebhookEventSelectorSchema).min(1).max(OUTGOING_WEBHOOK_EVENTS.length + 1).optional(),
  enabled: z.boolean().optional(),
  /** When true, a new signing secret is generated and returned once. */
  rotateSecret: z.boolean().optional(),
});
export type UpdateOutgoingWebhook = z.infer<typeof UpdateOutgoingWebhookSchema>;

export const OutgoingWebhookDeliveryStatusSchema = z.enum(['pending', 'success', 'failed']);
export type OutgoingWebhookDeliveryStatus = z.infer<typeof OutgoingWebhookDeliveryStatusSchema>;
