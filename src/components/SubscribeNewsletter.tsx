"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

class ApiRequestError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
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

type SubscribeStep = "email" | "subscribe" | "sign_in_code" | "subscribed";

export default function SubscribeNewsletter() {
  const router = useRouter();
  const [step, setStep] = useState<SubscribeStep>("email");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        setStep("subscribe");
        setStatusMessage("Looks like you're new here. Add your first name to subscribe.");
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
        source: "homepage",
        path: "/",
      });
      setStep("subscribed");
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

  async function handleVerifyCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await postJson("/api/subscriber/verify-code", { email, code });
      setStep("subscribed");
      router.refresh();
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Could not verify your code."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="subscribe" className="py-24 bg-[var(--watercolor-ink)] relative overflow-hidden">
      <div
        className="absolute -top-1/2 -right-1/5 w-[600px] h-[600px] rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, var(--watercolor-blue) 0%, transparent 60%)" }}
      />
      <div
        className="absolute -bottom-1/3 -left-1/10 w-[400px] h-[400px] rounded-full opacity-[0.08]"
        style={{ background: "radial-gradient(circle, var(--watercolor-rust) 0%, transparent 60%)" }}
      />

      <div className="container mx-auto px-6 max-w-[580px] text-center relative z-10">
        <h2 className="font-serif font-normal leading-[1.2] text-white mb-4" style={{ fontSize: "var(--text-section)" }}>
          Join the AI Recap Newsletter
        </h2>

        <p className="text-white/65 mb-10 max-w-[480px] mx-auto text-center" style={{ fontSize: "var(--text-body)" }}>
          Get the latest AI news, research insights, and practical implementation guides delivered to your inbox daily.
        </p>

        {step === "subscribed" ? (
          <div className="rounded-[20px] border border-white/12 bg-white/8 px-6 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-[var(--watercolor-ink)]">
              <CheckCircle2 size={24} />
            </div>
            <p className="mt-5 text-[24px] font-semibold text-white">You&apos;re subscribed.</p>
            <p className="mt-3 text-[16px] text-white/70">
              You can now use the same email to sign in and unlock any gated issue.
            </p>
          </div>
        ) : step === "sign_in_code" ? (
          <div className="rounded-[20px] border border-white/12 bg-white/8 px-6 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-[var(--watercolor-ink)]">
              <CheckCircle2 size={24} />
            </div>
            <p className="mt-5 text-[24px] font-semibold text-white">Check your inbox.</p>
            <p className="mt-3 text-[16px] text-white/70">
              Enter the 6-digit code we sent to {email.trim().toLowerCase()}.
            </p>
            <form className="mt-6 space-y-4" onSubmit={handleVerifyCodeSubmit}>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="123456"
                  className="h-15 flex-1 rounded-[6px] border border-white/16 bg-white/8 px-5 text-center text-[24px] font-semibold tracking-[0.3em] text-white placeholder:text-white/35 outline-none transition focus:border-white/40 focus:bg-white/10"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-15 items-center justify-center rounded-[4px] bg-white px-6 text-[17px] font-semibold text-[var(--text-primary)] transition hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? <LoaderCircle size={18} className="animate-spin" /> : "Verify code"}
                </button>
              </div>
              <div className="flex flex-col items-center gap-2 text-[14px]">
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
                  className="font-semibold text-white/75 transition hover:text-white"
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
                  className="font-semibold text-white/75 transition hover:text-white"
                >
                  Use a different email
                </button>
              </div>
            </form>
            {error ? <p className="mt-4 text-[15px] text-[#ffd2c4]">{error}</p> : null}
          </div>
        ) : (
          <>
            {step === "email" ? (
              <form className="space-y-5" onSubmit={handleEmailSubmit}>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  placeholder="Email*"
                  className="h-15 w-full rounded-[6px] border border-white/16 bg-white/8 px-5 text-[17px] text-white placeholder:text-white/45 outline-none transition focus:border-white/40 focus:bg-white/10"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-15 w-full items-center justify-center rounded-[4px] bg-white px-6 text-[17px] font-semibold text-[var(--text-primary)] transition hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? <LoaderCircle size={18} className="animate-spin" /> : "Continue"}
                </button>
                {error ? <p className="text-[15px] text-[#ffd2c4]">{error}</p> : null}
              </form>
            ) : (
              <form className="space-y-5" onSubmit={handleSubscribeSubmit}>
                <div className="rounded-[12px] border border-white/12 bg-white/8 px-5 py-4 text-left">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/45">Email</div>
                  <div className="mt-1 text-[17px] font-semibold text-white">{email.trim().toLowerCase()}</div>
                </div>
                <input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  type="text"
                  required
                  placeholder="First Name"
                  className="h-15 w-full rounded-[6px] border border-white/16 bg-white/8 px-5 text-[17px] text-white placeholder:text-white/45 outline-none transition focus:border-white/40 focus:bg-white/10"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-15 w-full items-center justify-center rounded-[4px] bg-white px-6 text-[17px] font-semibold text-[var(--text-primary)] transition hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? <LoaderCircle size={18} className="animate-spin" /> : "Subscribe"}
                </button>
                {statusMessage ? <p className="text-[15px] text-white/75">{statusMessage}</p> : null}
                {error ? <p className="text-[15px] text-[#ffd2c4]">{error}</p> : null}
                <button
                  type="button"
                  onClick={() => {
                    setFirstName("");
                    setError(null);
                    setStatusMessage(null);
                    setStep("email");
                  }}
                  className="text-[14px] font-semibold text-white/70 transition hover:text-white"
                >
                  Use a different email
                </button>
              </form>
            )}

            <p className="mt-5 text-white/55 text-[16px]">No spam, unsubscribe anytime. We respect your inbox.</p>
          </>
        )}

        <p className="mt-8 text-white/40 text-[14px] leading-relaxed">
          By subscribing, you agree to our <a href="/terms" className="underline hover:text-white/60">Terms of Service</a> and{" "}
          <a href="/privacy" className="underline hover:text-white/60">Privacy Policy</a>.
        </p>
      </div>
    </section>
  );
}
