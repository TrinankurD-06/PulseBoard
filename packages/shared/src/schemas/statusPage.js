import { z } from 'zod';
import { objectIdSchema } from './common.js';

// Lowercase letters, digits and single dashes: safe in a URL and easy to type.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fields = z.object({
  title: z.string().trim().min(1, 'Title is required').max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'At least 3 characters')
    .max(60)
    .regex(SLUG, 'Use lowercase letters, numbers and dashes (e.g. acme-status)'),
  description: z.string().trim().max(500).optional(),
  monitorIds: z.array(objectIdSchema).max(50, 'At most 50 monitors per page'),
  isPublic: z.boolean(),
});

export const statusPageSchema = fields.extend({
  description: fields.shape.description.default(''),
  monitorIds: fields.shape.monitorIds.default([]),
  isPublic: fields.shape.isPublic.default(true),
});

// No defaults here (Zod 4 would apply them inside .partial(), see D28).
export const updateStatusPageSchema = fields
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');
