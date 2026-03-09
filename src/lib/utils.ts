import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getTrimmedImageUrl(url?: string | null) {
  const trimmedUrl = url?.trim();
  return trimmedUrl ? trimmedUrl : null;
}
