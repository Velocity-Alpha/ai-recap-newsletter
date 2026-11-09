import Link from "next/link";

/** Small presentational pieces shared by the /admin pages. Server-safe: no hooks, no data. */

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-10 max-w-2xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">{eyebrow}</p>
      <h1 className="mt-2 font-serif text-[clamp(28px,4vw,40px)] leading-tight text-[var(--text-primary)]">{title}</h1>
      {children && <div className="mt-3 text-base leading-7 text-[var(--text-secondary)]">{children}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--border-light)] pb-2">
      <h2 className="font-serif text-xl text-[var(--text-primary)]">{children}</h2>
      {aside && <div className="text-sm text-[var(--text-secondary)]">{aside}</div>}
    </div>
  );
}

const TONES = {
  good: "bg-emerald-50 text-emerald-800",
  bad: "bg-red-50 text-red-800",
  warn: "bg-amber-50 text-amber-800",
  quiet: "bg-[var(--bg-warm)] text-[var(--text-secondary)]",
} as const;

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const tone = status === "succeeded" ? "good" : status === "failed" ? "bad" : status === "running" ? "warn" : "quiet";
  return <Badge tone={tone}>{status}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === "critical" ? "bad" : severity === "warning" ? "warn" : "quiet";
  return <Badge tone={tone}>{severity}</Badge>;
}

export function LevelBadge({ level }: { level: string }) {
  const tone = level === "error" ? "bad" : level === "warn" ? "warn" : "quiet";
  return <Badge tone={tone}>{level}</Badge>;
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[16px] border border-dashed border-[var(--border)] px-5 py-6 text-center text-sm text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

export function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)]">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top text-[var(--text-primary)] ${className}`}>{children}</td>;
}

/** Relative links stay in the app; absolute ones open as plain links. */
export function SmartLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} rel="noreferrer">
      {children}
    </a>
  );
}

export const linkClass =
  "font-medium text-[var(--accent-primary)] underline-offset-4 hover:text-[var(--accent-primary-hover)] hover:underline";
