import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceFns = vi.hoisted(() => ({
  unsubscribeSubscriberByToken: vi.fn(),
}));

vi.mock("@/src/features/subscriber/service", () => serviceFns);

import { GET, POST } from "@/app/api/subscriber/unsubscribe/route";

describe("/api/subscriber/unsubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a token from the query string", async () => {
    serviceFns.unsubscribeSubscriberByToken.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/subscriber/unsubscribe?token=signed-token"));
    const json = await response.json();

    expect(serviceFns.unsubscribeSubscriberByToken).toHaveBeenCalledWith({
      token: "signed-token",
    });
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("clears the session cookie and the signed-in hint after an unsubscribe", async () => {
    serviceFns.unsubscribeSubscriberByToken.mockResolvedValue({ id: 7, email: "reader@example.com" });

    const response = await GET(new Request("http://localhost/api/subscriber/unsubscribe?token=signed-token"));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      "ai_recap_subscriber=; Path=/; Max-Age=0; HttpOnly; SameSite=lax",
      "ai_recap_signed_in=; Path=/; Max-Age=0; SameSite=lax",
    ]);
  });

  it("keeps the reader's cookies when the token is not valid", async () => {
    serviceFns.unsubscribeSubscriberByToken.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/subscriber/unsubscribe?token=bad-token"));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("accepts a token from the json body", async () => {
    serviceFns.unsubscribeSubscriberByToken.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/subscriber/unsubscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: "signed-token" }),
      }),
    );
    const json = await response.json();

    expect(serviceFns.unsubscribeSubscriberByToken).toHaveBeenCalledWith({
      token: "signed-token",
    });
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
