import { z } from 'zod';
import { ROLES } from '../constants.js';

const workspaceName = z.string().trim().min(1, 'Name is required').max(80);

export const createWorkspaceSchema = z.object({ name: workspaceName });
export const updateWorkspaceSchema = z.object({ name: workspaceName });

const role = z.enum([ROLES.OWNER, ROLES.MEMBER, ROLES.VIEWER]);

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role,
});

export const updateMemberSchema = z.object({ role });

// Cost & Usage page (U5): a calendar month in UTC, "YYYY-MM".
export const workspaceUsageQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must look like YYYY-MM')
    .optional(),
});
