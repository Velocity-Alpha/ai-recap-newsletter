import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ unsubscribeSubscriberByToken: vi.fn() }));

vi.mock("@/src/features/subscriber/service", () => service);
vi.mock("@/src/components/Header", () => ({ default: () => null }));
vi.mock("@/src/components/Footer", () => ({ default: () => null }));
// Runs in the browser: signs this browser out (session cookie and signed-in hint) and unmarks the subscriber view.
vi.mock("@/src/components/ShowSignedOutView", () => ({ default: () => <i>signed-out view</i> }));

import UnsubscribePage from "@/app/unsubscribe/page";

async function renderPage(token?: string) {
  return renderToStaticMarkup(await UnsubscribePage({ searchParams: Promise.resolve({ token }) }));
}

describe("unsubscribe page", () => {
  beforeEach(() => {
    service.unsubscribeSubscriberByToken.mockReset();
  });

  it("switches this browser to the signed-out view after a real unsubscribe", async () => {
    service.unsubscribeSubscriberByToken.mockResolvedValue({ id: 1, email: "reader@example.com", status: "unsubscribed" });

    const html = await renderPage("valid-token");

    expect(service.unsubscribeSubscriberByToken).toHaveBeenCalledWith({ token: "valid-token" });
    expect(html).toContain("you have been unsubscribed");
    expect(html).toContain("signed-out view");
  });

  it("leaves the view alone when the link was not valid", async () => {
    service.unsubscribeSubscriberByToken.mockResolvedValue(null);

    const html = await renderPage("bad-token");

    expect(html).not.toContain("signed-out view");
  });

  it("leaves the view alone when the unsubscribe fails", async () => {
    service.unsubscribeSubscriberByToken.mockRejectedValue(new Error("database down"));

    const html = await renderPage("valid-token");

    expect(html).toContain("couldn&#x27;t process");
    expect(html).not.toContain("signed-out view");
  });
});
