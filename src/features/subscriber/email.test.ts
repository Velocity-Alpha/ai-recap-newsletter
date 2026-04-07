import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendSubscriberOtpEmail } from "@/features/subscriber/email";

describe("subscriber email", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_MAIL;
    process.env.RESEND_FROM_NAME = "AI Recap";
    process.env.NEXT_PUBLIC_SITE_URL = "https://airecap.news";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses RESEND_FROM_EMAIL as the sender env var", async () => {
    process.env.RESEND_FROM_EMAIL = "login@updates.airecap.news";
    fetchMock.mockResolvedValue({
      ok: true,
    });

    await sendSubscriberOtpEmail({
      email: "reader@example.com",
      code: "123456",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request.body));
    expect(body.from).toBe("AI Recap <login@updates.airecap.news>");
  });

  it("logs the resend response body when the send fails", async () => {
    process.env.RESEND_FROM_EMAIL = "login@updates.airecap.news";
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: vi.fn().mockResolvedValue('{"message":"sender not verified"}'),
    });

    await expect(
      sendSubscriberOtpEmail({
        email: "reader@example.com",
        code: "123456",
      }),
    ).rejects.toThrow("Could not send OTP email (status 422).");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[observability] subscriber.email.send.failure",
      expect.objectContaining({
        email: "rea***@example.com",
        status: 422,
        statusText: "Unprocessable Entity",
        body: '{"message":"sender not verified"}',
      }),
    );
  });
});
