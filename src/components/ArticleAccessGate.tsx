"use client";

import { CheckCircle2, ChevronRight, LoaderCircle, Mail } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export const SUBSCRIBED_TOAST_STORAGE_KEY = "ai-recap:subscriber-toast";

type GateStep = "email" | "subscribe" | "sign_in_code";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

class ApiRequestError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function postJson<TResponse>(url: string, body: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as { error?: string; code?: string } & TResponse | null;

  if (!response.ok) {
    throw new ApiRequestError(data?.error ?? "Something went wrong.", data?.code, response.status);
  }

  return data;
}

export default function ArticleAccessGate() {
  const [step, setStep] = useState<GateStep>("email");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  async function requestCodeForEmail(nextEmail: string) {
    await postJson("/api/subscriber/request-code", { email: nextEmail });
    setCode("");
    setStatusMessage(null);
    setStep("sign_in_code");
  }

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      await requestCodeForEmail(email);
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.status === 404) {
        setStatusMessage(`This email isn't subscribed yet. Add your first name to unlock the rest.`);
        setStep("subscribe");
        return;
      }

      setError(getErrorMessage(submitError, "Could not continue right now."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubscribeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      await postJson("/api/subscriber/subscribe", {
        firstName,
        email,
        source: "article_gate",
        path: pathname,
      });

      sessionStorage.setItem(SUBSCRIBED_TOAST_STORAGE_KEY, "1");
      router.refresh();
    } catch (submitError) {
      if (submitError instanceof ApiRequestError && submitError.code === "already_subscribed") {
        try {
          await requestCodeForEmail(email);
          return;
        } catch (requestCodeError) {
          setError(getErrorMessage(requestCodeError, "Could not send a sign-in code."));
          return;
        }
      }

      setError(getErrorMessage(submitError, "Could not subscribe right now."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      await postJson("/api/subscriber/verify-code", { email, code });
      router.refresh();
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Could not verify your code."));
    } finally {
      setSubmitting(false);
    }
  }

  if (dismissed) {
    return (
      <section id="subscribe" className="mx-auto max-w-[34rem] px-4 py-7 text-center sm:px-6 sm:py-9">
        <h2 className="font-serif text-[1.55rem] leading-[1.16] text-[var(--text-primary)] sm:text-[1.85rem]">
          This story is free.
        </h2>
        <p className="mx-auto mt-3 max-w-[24rem] text-[15px] leading-[1.65] text-[var(--text-secondary)] sm:text-[16px]">
          Subscribe once to unlock all the articles.
        </p>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[rgba(90,122,138,0.22)] bg-white/92 px-5 py-2.5 text-[14px] font-semibold text-[var(--text-primary)] shadow-[0_10px_24px_rgba(28,42,50,0.07)] transition hover:border-[rgba(90,122,138,0.36)] hover:bg-white"
          >
            Open subscribe form
            <ChevronRight size={15} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="subscribe"
      className="relative overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f8f7f4_100%)] px-6 py-10 shadow-[0_18px_40px_rgba(28,42,50,0.06)] sm:px-10"
    >
      <div
        className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, var(--watercolor-blue) 0%, transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, var(--watercolor-rust) 0%, transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-[33rem] text-center">
        <h2 className="font-serif text-[2rem] leading-[1.1] text-[var(--text-primary)] sm:text-[2.4rem]">
          {step === "email"
            ? "Keep reading for free"
            : step === "subscribe"
              ? "Almost there"
              : "Check your inbox"}
        </h2>

        <p className="mx-auto mt-4 max-w-[28rem] text-[17px] leading-[1.65] text-[var(--text-secondary)]">
          {step === "email"
            ? "Enter your email. If you're already subscribed, we'll send a sign-in code. If not, you'll subscribe in the next step."
            : step === "subscribe"
              ? "This email isn't subscribed yet. Add your first name to unlock this article and future issues."
              : `Enter the 6-digit code we sent to ${email.trim().toLowerCase()}.`}
        </p>

        {step === "email" ? (
          <form className="mt-8 space-y-4" onSubmit={handleEmailSubmit}>
            <label className="relative block">
              <Mail
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                placeholder="Enter your email"
                className="h-15 w-full rounded-[16px] border border-[var(--border)] bg-white pl-12 pr-4 text-[17px] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)]"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-15 min-w-[12rem] items-center justify-center rounded-[16px] bg-[var(--text-primary)] px-7 text-[17px] font-semibold text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? <LoaderCircle size={18} className="animate-spin" /> : "Continue"}
            </button>
            <p className="text-[14px] text-[var(--text-muted)]">
              Free access. Subscribe once, then use the same email on future issues.
            </p>
          </form>
        ) : step === "subscribe" ? (
          <form className="mt-8 space-y-4" onSubmit={handleSubscribeSubmit}>
            <div className="rounded-[18px] border border-[rgba(90,122,138,0.14)] bg-white/70 px-4 py-3 text-left">
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Email
              </div>
              <div className="mt-1 text-[17px] font-semibold text-[var(--text-primary)]">{email.trim().toLowerCase()}</div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                type="text"
                required
                placeholder="First name"
                className="h-15 flex-1 rounded-[16px] border border-[var(--border)] bg-white px-4 text-[17px] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)]"
              />
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-15 items-center justify-center rounded-[16px] bg-[var(--text-primary)] px-7 text-[17px] font-semibold text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? <LoaderCircle size={18} className="animate-spin" /> : "Subscribe free"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setFirstName("");
                setError(null);
                setStatusMessage(null);
                setStep("email");
              }}
              className="text-[14px] font-semibold text-[var(--accent-primary)] transition hover:opacity-75"
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={handleVerifyCode}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                className="h-15 flex-1 rounded-[16px] border border-[var(--border)] bg-white px-5 text-center text-[24px] font-semibold tracking-[0.3em] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)]"
              />
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-15 items-center justify-center rounded-[16px] bg-[var(--text-primary)] px-7 text-[17px] font-semibold text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? <LoaderCircle size={18} className="animate-spin" /> : "Verify code"}
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 pt-1 text-[14px]">
              <button
                type="button"
                onClick={async () => {
                  setSubmitting(true);
                  setError(null);
                  try {
                    await requestCodeForEmail(email);
                  } catch (submitError) {
                    setError(getErrorMessage(submitError, "Could not send a new code."));
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="font-semibold text-[var(--accent-primary)] transition hover:opacity-75"
              >
                Send a new code
              </button>
              <button
                type="button"
                onClick={() => {
                  setCode("");
                  setError(null);
                  setStatusMessage(null);
                  setStep("email");
                }}
                className="font-semibold text-[var(--accent-primary)] transition hover:opacity-75"
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        {statusMessage ? (
          <div className="mt-5 rounded-[18px] border border-[rgba(157,180,160,0.22)] bg-[rgba(157,180,160,0.10)] px-4 py-3 text-[15px] text-[var(--text-primary)]">
            {statusMessage}
          </div>
        ) : null}

        {error ? <p className="mt-4 text-[15px] text-[#a45239]">{error}</p> : null}

        <div className="mt-6 flex flex-col items-center gap-2 text-[15px] text-[var(--text-secondary)]">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[14px] underline decoration-[color:rgba(90,122,138,0.25)] underline-offset-4 transition hover:text-[var(--text-primary)]"
          >
            Not now
          </button>
        </div>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-[rgba(157,180,160,0.14)] px-4 py-2 text-[13px] font-semibold text-[var(--text-secondary)]">
          <CheckCircle2 size={14} className="text-[var(--watercolor-sage)]" />
          Free to read. Subscription just unlocks the full issue.
        </div>
      </div>
    </section>
  );
}
