import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combines conditional classes and resolves conflicting Tailwind utilities in favor of later inputs. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
