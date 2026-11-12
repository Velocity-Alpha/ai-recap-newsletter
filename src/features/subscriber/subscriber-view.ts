// The subscriber view, decided in the browser. Public pages always render the signed-out markup, so the CDN
// can cache one copy for everyone. Every element only a signed-out reader should see carries
// SIGNED_OUT_ONLY_ATTRIBUTE. When <html> carries SUBSCRIBER_VIEW_ATTRIBUTE, global CSS hides those elements and
// opens the article lock. The head script sets the attribute before the first paint from the signed-in hint
// cookie; the access gate and the subscribe form set it after a sign-in or subscribe. Browser-safe: no server
// imports.
import { SIGNED_IN_HINT_COOKIE, SIGNED_IN_HINT_VALUE } from "@/src/features/subscriber/signed-in-hint";

export const SUBSCRIBER_VIEW_ATTRIBUTE = "data-subscriber";
export const SIGNED_OUT_ONLY_ATTRIBUTE = "data-signed-out-only";
/** Marks the article lock's height clip, so the subscriber view can lift it. */
export const ARTICLE_LOCK_CLIP_ATTRIBUTE = "data-article-lock-clip";

/** Spread onto an element only a signed-out reader should see. */
export const signedOutOnly = { [SIGNED_OUT_ONLY_ATTRIBUTE]: "" } as const;
/** Spread onto the article lock's height clip. */
export const articleLockClip = { [ARTICLE_LOCK_CLIP_ATTRIBUTE]: "" } as const;

/**
 * True when a cookie string (document.cookie) holds the signed-in hint: pass SIGNED_IN_HINT_COOKIE and
 * SIGNED_IN_HINT_VALUE. Self-contained on purpose: the head script is built from this function's source, so it
 * must not use anything from outside its own body, which is why the hint's name and value are parameters.
 */
export function hasSignedInHint(cookieString: string, hintName: string, hintValue: string) {
  const parts = cookieString.split(";");
  for (let index = 0; index < parts.length; index++) {
    if (parts[index].trim() === hintName + "=" + hintValue) {
      return true;
    }
  }
  return false;
}

/** Inline script for the start of <head>: marks the page as subscriber view before the first paint. */
export const SUBSCRIBER_VIEW_HEAD_SCRIPT = `try{if((${hasSignedInHint.toString()})(document.cookie,${JSON.stringify(
  SIGNED_IN_HINT_COOKIE,
)},${JSON.stringify(SIGNED_IN_HINT_VALUE)})){document.documentElement.setAttribute(${JSON.stringify(
  SUBSCRIBER_VIEW_ATTRIBUTE,
)},"")}}catch(e){}`;

/** Shows the subscriber view on this page. The route that signed the reader in has set the hint cookie. */
export function markSubscriberView(doc: Document = document) {
  doc.documentElement.setAttribute(SUBSCRIBER_VIEW_ATTRIBUTE, "");
}

/** Shows the signed-out view on this page and clears the hint cookie, so other pages show it too. */
export function unmarkSubscriberView(doc: Document = document) {
  doc.documentElement.removeAttribute(SUBSCRIBER_VIEW_ATTRIBUTE);
  doc.cookie = `${SIGNED_IN_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Signs this browser out: shows the signed-out view at once, then asks the sign-out route to clear the httpOnly
 * session cookie, which browser code cannot touch. For pages that end a subscription.
 */
export async function signOutThisBrowser(doc: Document = document, fetchImpl: typeof fetch = fetch) {
  unmarkSubscriberView(doc);
  try {
    await fetchImpl("/api/subscriber/sign-out", { method: "POST", credentials: "same-origin" });
  } catch {
    // The view and the hint are already signed out; the session cookie runs out on its own.
  }
}
