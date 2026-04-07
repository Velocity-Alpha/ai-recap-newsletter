"use client";

import { useEffect, useRef, useState } from "react";

import { getArticlePreviewHeight } from "@/components/articlePreview";

export default function ArticlePreviewLock({
  children,
  gate,
}: {
  children: React.ReactNode;
  gate: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [shouldLock, setShouldLock] = useState(true);
  const previewHeight = getArticlePreviewHeight(viewportWidth);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!contentRef.current) {
      return;
    }

    function updateLockState() {
      const element = contentRef.current;
      if (!element) {
        return;
      }

      setShouldLock(element.scrollHeight > previewHeight + 48);
    }

    const observer = new ResizeObserver(() => {
      updateLockState();
    });
    observer.observe(contentRef.current);

    const frameId = window.requestAnimationFrame(() => {
      updateLockState();
    });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [previewHeight]);

  if (!shouldLock) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className="relative overflow-hidden"
        style={{ maxHeight: `${previewHeight}px` }}
      >
        {children}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-56 sm:h-72"
          style={{
            background:
              "linear-gradient(180deg, rgba(250,250,248,0) 0%, rgba(250,250,248,0.18) 28%, rgba(250,250,248,0.42) 58%, rgba(250,250,248,0.72) 82%, var(--bg-main) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 bg-[var(--bg-main)] px-6 pb-6 shadow-[0_-20px_36px_-30px_rgba(28,42,50,0.28)] sm:px-0 sm:pb-2 sm:shadow-[0_-24px_44px_-34px_rgba(28,42,50,0.3)]">
        <div className="relative">
          {gate}
        </div>
      </div>
    </div>
  );
}
