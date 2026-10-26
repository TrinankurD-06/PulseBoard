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
