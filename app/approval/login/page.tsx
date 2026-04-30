"use client";

import { useState, Suspense } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setLoading(true);
    setError("");

    const res = await fetch("/api/approval/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      setRedirecting(true);
      const redirect = searchParams.get("redirect") || "/approval";
      router.push(redirect);
    } else {
      setLoading(false);
      setError("Password incorrect.");
      setPassword("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      {redirecting && (
        <div className="rounded-lg bg-[var(--accent-primary)]/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-[var(--accent-primary)]">
            Redirecting to approval board…
          </p>
        </div>
      )}
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          required
          disabled={loading || redirecting}
          autoFocus
          className="w-full rounded-xl border border-[var(--border-light)] bg-[var(--bg-main)] px-4 py-3 pr-11 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-primary)] transition disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setShowPassword((value) => !value)}
          disabled={loading || redirecting}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 inline-flex items-center justify-center px-3 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
      <button
        type="submit"
        disabled={loading || redirecting}
        className="inline-flex items-center justify-center rounded-full bg-[var(--text-primary)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {redirecting ? "Redirecting…" : loading ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

export default function ApprovalLoginPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-4 py-12 sm:px-6">
      <div className="mx-auto flex min-h-[70vh] max-w-sm items-center justify-center">
        <div className="w-full rounded-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] px-6 py-10 shadow-[0_30px_80px_rgba(61,79,95,0.12)] sm:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
            Approval Board
          </p>
          <h1 className="mt-3 font-serif text-3xl leading-tight text-[var(--text-primary)]">
            Enter password
          </h1>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
