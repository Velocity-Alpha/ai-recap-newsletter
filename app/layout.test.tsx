import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Libre_Baskerville: () => ({ variable: "font-serif" }),
  Source_Sans_3: () => ({ variable: "font-sans" }),
}));
vi.mock("@/src/components/GoogleAnalytics", () => ({ default: () => null }));
vi.mock("@/src/components/ScrollProgress", () => ({ default: () => null }));

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
});
