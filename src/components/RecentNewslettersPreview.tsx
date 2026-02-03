'use client'

import { useEffect, useState } from "react";
import NewsletterCard from "./NewsletterCard";
import { Newsletter } from "../types/newsletter.types";
import Link from "next/link";
import { getApiUrl } from "../utils/apiConfig";

const RecentNewslettersPreview: React.FC = () => {
  const [newslettersData, setNewsletterData] = useState<Newsletter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const apiUrl = getApiUrl('getOverviewData');
        // Request first page with 6 items
        const url = apiUrl.startsWith('http') 
          ? new URL(apiUrl)
          : new URL(apiUrl, window.location.origin);
        url.searchParams.set('page', '1');
        url.searchParams.set('limit', '6');
        
        const res = await fetch(url.toString(), {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await res.json();
        
        if (data.success && data.data) {
          setNewsletterData(data.data);
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
  }, []);

  return (
      <section id="newsletters" className="py-24 bg-[var(--bg-card)] relative">
      <div className="container mx-auto px-6 max-w-[var(--container)]">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="uppercase tracking-[0.22em] font-bold text-[var(--accent-warm)] mb-3" style={{ fontSize: 'var(--text-caption)' }}>
            Latest Updates
          </div>
          <h2 className="font-serif font-normal leading-[1.12] tracking-[-0.015em] text-[var(--text-primary)] mb-4" style={{ fontSize: 'var(--text-section)' }}>
            Recent Newsletters
          </h2>
          <p className="text-[var(--text-secondary)] max-w-[520px] mx-auto leading-[1.7]" style={{ fontSize: 'var(--text-body)' }}>
            Explore our most recent AI intelligence briefings and insights
          </p>
        </div>

        {/* Content State */}
        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-12 h-12 border-4 border-[var(--border-light)] border-t-[var(--accent-primary)] rounded-full animate-spin"></div>
          </div>
        ) : newslettersData.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-[var(--text-secondary)]">
              <h3 className="font-serif mb-3" style={{ fontSize: 'var(--text-section)' }}>
                Archives are currently empty
              </h3>
              <p className="mb-8 max-w-md mx-auto" style={{ fontSize: 'var(--text-body)' }}>
                We're preparing our first set of AI intelligence reports. 
                Be the first to know when they drop!
              </p>
              <button 
                onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-6 py-3 bg-[var(--text-primary)] text-white font-semibold rounded transition-all duration-200 hover:bg-[var(--watercolor-ink)]" style={{ fontSize: 'var(--text-small)' }}
              >
                Keep Me Updated
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
              {newslettersData.map((item) => (
                <NewsletterCard key={item.id} item={item} />
              ))}
            </div>

            {/* View All Button */}
            <div className="text-center">
              <Link
                href="/newsletters"
                className="inline-block px-6 py-3 bg-transparent text-[var(--text-primary)] text-[14px] font-semibold rounded border border-[var(--border)] transition-all duration-200 hover:border-[var(--text-primary)] hover:bg-[var(--bg-warm)]"
              >
                View All Newsletters →
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default RecentNewslettersPreview;
