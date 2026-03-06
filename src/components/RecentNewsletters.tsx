'use client'

import React, { useEffect, useState } from "react";
import NewsletterCard from "./NewsletterCard";
import Pagination from "./Pagination";
import { Newsletter } from "../types/newsletter.types";
import { getApiUrl } from "../utils/apiConfig";
import { Newspaper, Send } from "lucide-react";

const ITEMS_PER_PAGE = 6;

const RecentNewsletters: React.FC = () => {
  const [newslettersData, setNewsletterData] = useState<Newsletter[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const apiUrl = getApiUrl('fetch-newsletters-list');
        // Handle both absolute and relative URLs
        const url = apiUrl.startsWith('http') 
          ? new URL(apiUrl)
          : new URL(apiUrl, window.location.origin);
        url.searchParams.set('page', currentPage.toString());
        url.searchParams.set('limit', ITEMS_PER_PAGE.toString());
        
        const res = await fetch(url.toString(), {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          setNewsletterData([]);
          setTotalPages(1);
          return;
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          setNewsletterData([]);
          setTotalPages(1);
          return;
        }

        const data = await res.json();
        
        if (data.success && data.data) {
          if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
            if (data.pagination.totalPages > 0 && currentPage > data.pagination.totalPages) {
              setCurrentPage(data.pagination.totalPages);
              return;
            }
          }
          setNewsletterData(data.data);
        } else {
          setNewsletterData([]);
          setTotalPages(1);
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          const message = error instanceof Error ? error.message : 'Unknown fetch error';
          console.warn(`Recent newsletters archive unavailable: ${message}`);
        }
        setNewsletterData([]);
        setTotalPages(1);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

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

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {[...Array(6)].map((_, index) => (
            <div
              key={index}
              className="group bg-white border border-gray-200 rounded-2xl overflow-hidden min-w-[320px] max-w-[400px] animate-pulse"
            >
              {/* Image skeleton */}
              <div className="relative h-[220px] bg-gray-200">
                {/* Date badge skeleton */}
                <div className="absolute top-4 left-4 w-24 h-8 bg-gray-300 rounded-full"></div>
                {/* Title skeleton on image */}
                <div className="absolute bottom-0 left-0 right-0 p-5 space-y-2">
                  <div className="h-5 bg-gray-300 rounded w-3/4"></div>
                  <div className="h-5 bg-gray-300 rounded w-1/2"></div>
                </div>
              </div>

              {/* Content skeleton */}
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
                <div className="h-4 bg-gray-200 rounded w-24"></div>
              </div>
            </div>
          ))}
        </div>
      ) : newslettersData.length === 0 ? (
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
            <button
              type="button"
              onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center justify-center gap-2 rounded bg-[var(--text-primary)] px-7 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--watercolor-ink)]"
              style={{ fontSize: 'var(--text-small)' }}
            >
              <Send size={20} />
              Get Notified
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-7 py-3 font-semibold text-[var(--text-primary)] transition-colors duration-200 hover:bg-[var(--bg-warm)]"
              style={{ fontSize: 'var(--text-small)' }}
            >
              Check Again
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {newslettersData.map((item) => (
              <NewsletterCard key={item.id} item={item} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-12">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
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
