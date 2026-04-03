"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

import { SUBSCRIBED_TOAST_STORAGE_KEY } from "@/src/components/ArticleAccessGate";

export default function SubscriptionSuccessToast() {
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!sessionStorage.getItem(SUBSCRIBED_TOAST_STORAGE_KEY)) {
      return;
    }

    sessionStorage.removeItem(SUBSCRIBED_TOAST_STORAGE_KEY);
    let enterFrameId = 0;
    const mountFrameId = window.requestAnimationFrame(() => {
      setRendered(true);
      enterFrameId = window.requestAnimationFrame(() => {
        setVisible(true);
      });
    });
    const hideTimeoutId = window.setTimeout(() => {
      setVisible(false);
    }, 3000);
    const unmountTimeoutId = window.setTimeout(() => {
      setRendered(false);
    }, 3350);

    return () => {
      window.cancelAnimationFrame(mountFrameId);
      window.cancelAnimationFrame(enterFrameId);
      window.clearTimeout(hideTimeoutId);
      window.clearTimeout(unmountTimeoutId);
    };
  }, []);

  if (!rendered) {
    return null;
  }

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-5 z-[70] flex justify-center px-4 transition-all duration-350 ease-out ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-[18px] border border-[rgba(212,221,227,0.9)] bg-white px-5 py-4 shadow-[0_18px_45px_rgba(25,37,44,0.14)]">
        <CheckCircle2 size={26} className="text-[#6fd24c]" />
        <span className="text-[19px] font-semibold text-[var(--text-primary)]">Subscribed!</span>
      </div>
    </div>
  );
}
