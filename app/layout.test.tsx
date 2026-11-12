import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Libre_Baskerville: () => ({ variable: "font-serif" }),
  Source_Sans_3: () => ({ variable: "font-sans" }),
}));
vi.mock("@/src/components/GoogleAnalytics", () => ({ default: () => null }));
vi.mock("@/src/components/ScrollProgress", () => ({ default: () => null }));
vi.mock("@/src/components/SubscriptionSuccessToast", () => ({ default: () => <i>subscribed toast</i> }));

import RootLayout from "@/app/layout";
import { SUBSCRIBER_VIEW_HEAD_SCRIPT } from "@/src/features/subscriber/subscriber-view";

describe("root layout", () => {
  it("runs the subscriber view script first in the head, before the page paints", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );

    expect(html).toContain(`<head><script>${SUBSCRIBER_VIEW_HEAD_SCRIPT}</script>`);
  });

  // Every subscribe form (the home and archive form, the issue's access gate) hides itself in the subscriber view
  // at once, so the confirmation is a toast mounted outside them, on every page.
  it("mounts the Subscribed! toast on every page", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>Page</p>
      </RootLayout>,
    );

    expect(html).toContain("subscribed toast");
  });
});
