// The signed-in hint: a browser-readable cookie that says "this browser has a subscriber session".
// Its value is "1"; it carries no email and no id. It only decides the display, so it is safe to
// import from browser code. The server sets and clears it next to the session cookie
// (setSubscriberSessionCookies / clearSubscriberSessionCookies in ./server).
export const SIGNED_IN_HINT_COOKIE = "ai_recap_signed_in";
export const SIGNED_IN_HINT_VALUE = "1";
