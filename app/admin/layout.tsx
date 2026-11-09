import type { Metadata } from "next";
import Link from "next/link";

import AdminNav from "@/src/components/admin/AdminNav";

export const metadata: Metadata = {
  title: "Operations | AI Recap",
  robots: { index: false, follow: false },
};

// No access check here: layouts do not re-run on every navigation. Each page calls requireAdminPage().
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      <header className="border-b border-[var(--border-light)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-4 px-4 py-5 sm:px-6">
          <Link href="/admin" className="font-serif text-xl text-[var(--text-primary)]">
            AI Recap <span className="italic text-[var(--text-secondary)]">operations</span>
          </Link>
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6">{children}</main>
    </div>
  );
}
