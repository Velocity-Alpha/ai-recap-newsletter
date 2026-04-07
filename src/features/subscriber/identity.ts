export function normalizeSubscriberEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidSubscriberEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
