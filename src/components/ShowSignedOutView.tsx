"use client";

import { useEffect } from "react";

import { unmarkSubscriberView } from "@/src/features/subscriber/subscriber-view";

// For server pages that cannot set cookies, such as /unsubscribe: clears the signed-in hint in the browser and
// shows the signed-out view, here and on every page opened after.
export default function ShowSignedOutView() {
  useEffect(() => {
    unmarkSubscriberView();
  }, []);

  return null;
}
