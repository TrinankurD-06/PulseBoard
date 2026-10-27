import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class joiner: conditional classes, later Tailwind classes win. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
