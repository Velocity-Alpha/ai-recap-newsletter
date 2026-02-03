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
        const data = await res.json();
        
        if (data.success && data.data) {
          setNewsletterData(data.data);
          if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
          }
        } else {
          setNewsletterData([]);
        }
      } catch (error) {
        console.error(error);
        setNewsletterData([]);
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
        <div className="text-center py-24 flex flex-col items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center text-[#66ccff] mb-8 shadow-inner">
            <Newspaper size={48} />
          </div>
          <h3 className="syne-mono-regular text-3xl font-bold text-gray-900 mb-4">
            Intelligence Briefing Pending
          </h3>
          <p className="molengo-regular text-xl text-gray-600 max-w-lg mx-auto mb-10 leading-relaxed">
            Our analysts are currently synthesizing the latest AI breakthroughs. 
            The next edition of AI Recap is on its way!
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a 
              href="/#subscribe" 
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#66ccff] text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300"
            >
              <Send size={20} />
              Get Notified
            </a>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-4 bg-white text-gray-700 border border-gray-200 rounded-xl font-bold text-lg hover:bg-gray-50 transition-all shadow-sm"
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
