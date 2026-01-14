'use client'

import { useEffect, useState } from "react";
import NewsletterCard from "./NewsletterCard";
import Pagination from "./Pagination"; 
import { Newsletter } from "../types/newsletter.types";
import { getApiUrl } from "../utils/apiConfig";

const ITEMS_PER_PAGE = 6;

const RecentNewsletters: React.FC = () => {
  const [newslettersData, setNewsletterData] = useState<Newsletter[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = getApiUrl('getOverviewData');
        const res = await fetch(apiUrl, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await res.json();
        setNewsletterData(data?.data || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const totalPages = Math.ceil(newslettersData.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentItems = newslettersData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (loading) {
    return (
      <section className="pb-20 max-w-[90%] mx-auto">
        <div className="text-center py-20">
          <p className="text-gray-600">Loading newsletters...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="pb-20 max-w-[90%] mx-auto pt-12 relative overflow-hidden">
      {/* Unique animated background for Newsletters page - Hexagonal pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Hexagonal grid pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 200 200" preserveAspectRatio="none">
            <defs>
              <pattern id="hexagons" width="40" height="34.64" patternUnits="userSpaceOnUse">
                <polygon points="20,0 40,8.66 40,25.98 20,34.64 0,25.98 0,8.66" fill="none" stroke="#66ccff" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hexagons)" className="animate-grid" style={{ animationDuration: '30s' }} />
          </svg>
        </div>
        
        {/* Animated diagonal stripes */}
        <div className="absolute inset-0">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent transform rotate-12"
              style={{
                top: `${i * 15}%`,
                left: `${i * -10}%`,
                animation: `lineMove ${15 + i * 2}s linear infinite`,
                animationDelay: `${i * 0.5}s`
              }}
            />
          ))}
        </div>
        
        {/* Floating geometric shapes */}
        <div className="absolute top-20 right-20 w-24 h-24 border-2 border-primary/20 rotate-45 animate-rotate-slow"></div>
        <div className="absolute bottom-40 left-20 w-20 h-20 border-2 border-primary/20 rounded-full animate-pulse-slow"></div>
        <div className="absolute top-1/2 right-1/3 w-16 h-16 border-2 border-primary/20 rotate-45 animate-rotate-slow animation-delay-2000" style={{ animationDirection: 'reverse' }}></div>
      </div>
      
      <div className="relative z-10">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-black">
          All Newsletters
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Browse through all our AI intelligence newsletters
        </p>
      </div>

      {currentItems.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-600">No newsletters available yet.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {currentItems.map((item) => (
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

