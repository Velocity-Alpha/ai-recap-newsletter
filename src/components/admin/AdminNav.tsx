"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/runs", label: "Runs" },
  { href: "/admin/incidents", label: "Incidents" },
  { href: "/admin/settings", label: "Settings" },
];

export default function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "text-[var(--text-primary)] underline decoration-[var(--accent-warm)] decoration-2 underline-offset-[6px]"
                : "text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
            }
          >
            {link.label}
          </Link>
        );
      })}
      <Link href="/approval" className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]">
        Board →
      </Link>
    </nav>
  );
}
