import React from "react";
import Link from "next/link";
import NewsletterCard from "./NewsletterCard";
import Pagination from "./Pagination";
import { Newsletter } from "../types/newsletter.types";
import { Newspaper, Send } from "lucide-react";

interface RecentNewslettersProps {
  newsletters: Newsletter[];
  currentPage: number;
  totalPages: number;
  showSubscribeButton?: boolean;
}

const RecentNewsletters: React.FC<RecentNewslettersProps> = ({
  newsletters,
  currentPage,
  totalPages,
  showSubscribeButton = true,
}) => {
  return (
    <section className="pb-24 max-w-7xl mx-auto pt-16 px-4 sm:px-6 lg:px-8 relative">
      <div className="relative z-10">
      <div className="text-center mb-16">
        <div className="uppercase tracking-[0.22em] font-bold text-[var(--accent-warm)] mb-3" style={{ fontSize: 'var(--text-caption)' }}>
          Archive
        </div>
        <h1 className="font-serif font-normal text-[var(--text-primary)] mb-4" style={{ fontSize: 'var(--text-section)' }}>
          Past Editions
        </h1>
        <p className="text-[var(--text-secondary)] max-w-2xl mx-auto leading-[1.7]" style={{ fontSize: 'var(--text-body)' }}>
          Browse through past editions of AI Recap
        </p>
      </div>

      {newsletters.length === 0 ? (
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-6 py-16 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-4 duration-700 sm:px-10">
          <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-[var(--bg-warm)] text-[var(--accent-primary)] shadow-inner">
            <Newspaper size={48} />
          </div>
          <h3 className="mb-4 font-serif font-normal text-[var(--text-primary)]" style={{ fontSize: 'var(--text-section)' }}>
            No editions on this page
          </h3>
          <p className="mb-10 max-w-lg text-[var(--text-secondary)] leading-[1.7]" style={{ fontSize: 'var(--text-body)' }}>
            There isn&apos;t an archive entry here right now. You can subscribe below and we&apos;ll send the next briefing as soon as it goes out.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            {showSubscribeButton ? (
              <Link
                href="#subscribe"
                className="inline-flex items-center justify-center gap-2 rounded bg-[var(--text-primary)] px-7 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--watercolor-ink)]"
                style={{ fontSize: 'var(--text-small)' }}
              >
                <Send size={20} />
                Get Notified
              </Link>
            ) : null}
            <Link
              href={currentPage <= 1 ? "/archive" : `/archive?page=${currentPage}`}
              className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-7 py-3 font-semibold text-[var(--text-primary)] transition-colors duration-200 hover:bg-[var(--bg-warm)]"
              style={{ fontSize: 'var(--text-small)' }}
            >
              Check Again
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {newsletters.map((item) => (
              <NewsletterCard key={item.id} item={item} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-12">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                basePath="/archive"
              />
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
};

export default RecentNewsletters;
