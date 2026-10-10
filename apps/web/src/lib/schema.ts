import { z } from 'zod';

export const checkoutSchema = z.object({
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).min(1),
  guestName: z.string().trim().min(2).max(120).optional(),
  guestPhone: z.string().trim().min(8).max(20).optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

export const adminMenuSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: z.string().uuid(),
  description: z.string().trim().max(500).optional(),
  pricePaise: z.number().int().positive(),
  isAvailable: z.boolean().optional(),
});

export const orderStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled']),
});
