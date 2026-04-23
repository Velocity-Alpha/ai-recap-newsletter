import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendSubscriberOtpEmail,
  sendSubscriberWelcomeEmail,
} from "@/src/features/subscriber/email";
import { buildSubscriberWelcomeEmail } from "@/src/features/subscriber/welcomeEmailTemplate";

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

  it("uses the shared welcome email template for new subscribers", async () => {
    process.env.RESEND_FROM_EMAIL = "login@updates.airecap.news";
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
    });

    await sendSubscriberWelcomeEmail({
      email: "reader@example.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request.body));
    const expected = buildSubscriberWelcomeEmail("https://airecap.news");
    expect(body.subject).toBe(expected.subject);
    expect(body.text).toBe(expected.text);
    expect(body.html).toContain('src="https://airecap.news/uploads/email_one.gif"');
    expect(body.html).toContain('src="https://airecap.news/uploads/email_two.gif"');
  });
});
