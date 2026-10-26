/** Joins class names, skipping falsy values: cn('a', isOn && 'b'). */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
