import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    // bcrypt silently ignores bytes beyond 72, so longer passwords would give a false sense of security.
    .max(72, 'Password must be at most 72 characters'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(72),
});
