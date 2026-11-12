"use client";

import { useEffect } from "react";

import { signOutThisBrowser } from "@/src/features/subscriber/subscriber-view";

// For server pages that cannot set cookies, such as /unsubscribe: signs this browser out (the session cookie and
// the signed-in hint) and shows the signed-out view, here and on every page opened after.
export default function ShowSignedOutView() {
  useEffect(() => {
    void signOutThisBrowser();
  }, []);

  return null;
}
