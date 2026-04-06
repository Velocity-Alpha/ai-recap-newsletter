import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceFns = vi.hoisted(() => ({
  SubscriberError: class SubscriberError extends Error {
    statusCode: number;
    code?: string;

    constructor(message: string, statusCode = 400, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  unsubscribeSubscriberFromWebhook: vi.fn(),
}));

vi.mock("@/src/features/subscriber/service", () => serviceFns);

import { POST } from "@/app/api/subscriber/unsubscribe/webhook/route";

describe("/api/subscriber/unsubscribe/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GHL_UNSUBSCRIBE_WEBHOOK_SECRET = "test-secret";
  });

  it("rejects requests without the webhook secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/subscriber/unsubscribe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "reader@example.com" }),
      }),
    );
    const json = await response.json();

    expect(serviceFns.unsubscribeSubscriberFromWebhook).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("accepts a bearer token and unsubscribes the email", async () => {
    serviceFns.unsubscribeSubscriberFromWebhook.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/subscriber/unsubscribe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-secret",
        },
        body: JSON.stringify({ email: "reader@example.com" }),
      }),
    );
    const json = await response.json();

    expect(serviceFns.unsubscribeSubscriberFromWebhook).toHaveBeenCalledWith({
      email: "reader@example.com",
    });
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
