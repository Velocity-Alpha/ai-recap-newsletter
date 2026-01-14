'use client'

import { useEffect, useState } from "react";
import NewsletterCard from "./NewsletterCard";
import { Newsletter } from "../types/newsletter.types";
import Link from "next/link";
import ScrollAnimation from "./ScrollAnimation";
import { getApiUrl } from "../utils/apiConfig";

const RecentNewslettersPreview: React.FC = () => {
  const [newslettersData, setNewsletterData] = useState<Newsletter[]>([]);
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
        // Only take the first 6 newsletters
        setNewsletterData((data?.data || []).slice(0, 6));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <section id="newsletters" className="pb-20 max-w-[90%] mx-auto">
        <div className="text-center py-20">
          <p className="text-gray-600">Loading newsletters...</p>
        </div>
      </section>
    );
  }

  return (
      <section id="newsletters" className="py-24 bg-[#F5F5F5] relative overflow-hidden">
      {/* Unique animated background for Newsletters - Wave pattern with dots */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Animated wave lines */}
        <div className="absolute top-0 left-0 w-full">
          <svg className="absolute top-0 left-0 w-full h-full opacity-20" viewBox="0 0 1200 100" preserveAspectRatio="none">
            <path d="M0,50 Q300,0 600,50 T1200,50" stroke="#66ccff" strokeWidth="2" fill="none" className="animate-wave" />
            <path d="M0,50 Q300,100 600,50 T1200,50" stroke="#66ccff" strokeWidth="2" fill="none" className="animate-wave animation-delay-2000" />
          </svg>
        </div>
        
        {/* Animated dots pattern */}
        <div className="absolute inset-0">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 bg-[#66ccff]/30 rounded-full animate-dots"
              style={{
                left: `${(i * 5) % 100}%`,
                top: `${(i * 7) % 100}%`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
        
        {/* Floating circles */}
        <div className="absolute top-1/4 right-1/4 w-32 h-32 border border-[#66ccff]/20 rounded-full animate-float"></div>
        <div className="absolute bottom-1/3 left-1/4 w-24 h-24 border border-[#66ccff]/20 rounded-full animate-float animation-delay-2000"></div>
        
        {/* Zigzag lines */}
        <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent">
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(90deg, transparent, transparent 20px, #66ccff40 20px, #66ccff40 21px)',
            animation: 'zigzag 10s linear infinite'
          }}></div>
        </div>
      </div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="inline-block px-4 py-1.5 rounded-full bg-[#66ccff]/10 text-[#66ccff] text-sm font-semibold mb-4 border border-[#66ccff]/20">
            Latest Updates
          </div>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-black mb-6">
            Recent Newsletters
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Explore our most recent AI intelligence briefings and insights
          </p>
        </div>

      {newslettersData.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-600 text-lg">No newsletters available yet.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 mb-12">
            {newslettersData.map((item, index) => (
              <ScrollAnimation 
                key={item.id} 
                animationType="scale" 
                delay={index * 100}
                className={`stagger-${index + 1}`}
              >
                <NewsletterCard item={item} />
              </ScrollAnimation>
            ))}
          </div>

          {/* View All Button */}
          <div className="text-center">
            <Link
              href="/newsletters"
              className="group inline-flex items-center gap-2 px-10 py-4 bg-[#66ccff] text-black rounded-xl font-semibold text-lg shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 hover:bg-[#66ccff]/90"
            >
              View All Newsletters
              <span className="group-hover:translate-x-1 transition-transform duration-300">→</span>
            </Link>
          </div>
        </>
      )}
      </div>
    </section>
  );
};

export default RecentNewslettersPreview;

