// The "Subscribed!" toast's signal. A subscribe form announces a subscribe; SubscriptionSuccessToast (mounted
// once in the root layout) shows the toast once. The flag sits in sessionStorage, so the toast still shows
// when the page changes before it mounts. Browser-safe: no server imports.

const SUBSCRIBED_TOAST_STORAGE_KEY = "ai-recap:subscriber-toast";
/** Tells a mounted SubscriptionSuccessToast to check for a subscribe now. */
export const SUBSCRIBED_TOAST_EVENT = "ai-recap:subscribed";

/** Call after a subscribe succeeds: the toast shows on this page, or on the next one. */
export function announceSubscribed(storage: Storage = sessionStorage, target: EventTarget = window) {
  storage.setItem(SUBSCRIBED_TOAST_STORAGE_KEY, "1");
  target.dispatchEvent(new Event(SUBSCRIBED_TOAST_EVENT));
}

/** True once after announceSubscribed: the toast should show now. Clears the flag. */
export function takeSubscribedToast(storage: Storage = sessionStorage): boolean {
  if (!storage.getItem(SUBSCRIBED_TOAST_STORAGE_KEY)) {
    return false;
  }
  storage.removeItem(SUBSCRIBED_TOAST_STORAGE_KEY);
  return true;
}
