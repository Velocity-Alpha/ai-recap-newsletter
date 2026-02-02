'use client'

import { useEffect, useState } from "react";
import NewsletterCard from "./NewsletterCard";
import { Newsletter } from "../types/newsletter.types";
import Link from "next/link";
import ScrollAnimation from "./ScrollAnimation";
import { getApiUrl } from "../utils/apiConfig";
import { Newspaper, Bell } from "lucide-react";

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
          <h2 className="syne-mono-regular text-4xl md:text-5xl lg:text-6xl font-bold text-black mb-6">
            Recent Newsletters
          </h2>
          <p className="molengo-regular text-xl text-gray-600 max-w-2xl mx-auto">
            Explore our most recent AI intelligence briefings and insights
          </p>
        </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 mb-12">
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
        <div className="text-center py-20 bg-white/50 backdrop-blur-sm rounded-3xl border border-[#66ccff]/10 shadow-xl overflow-hidden relative">
          {/* Subtle background pattern for the empty state box */}
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <div className="absolute top-0 left-0 w-full h-full" style={{ backgroundImage: 'radial-gradient(#66ccff 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
          </div>
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 bg-[#66ccff]/10 rounded-2xl flex items-center justify-center text-[#66ccff] mb-6 transform -rotate-6">
              <Newspaper size={40} />
            </div>
            <h3 className="syne-mono-regular text-2xl md:text-3xl font-bold text-black mb-3">
              Archives are currently empty
            </h3>
            <p className="molengo-regular text-lg text-gray-600 max-w-md mx-auto mb-8">
              We&apos;re preparing our first set of AI intelligence reports. 
              Be the first to know when they drop!
            </p>
            <a 
              href="#subscribe" 
              className="group inline-flex items-center gap-2 px-8 py-3 bg-[#66ccff] text-white rounded-xl font-bold transition-all hover:bg-[#66ccff]/90"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <Bell size={18} className="animate-bounce" />
              Keep Me Updated
            </a>
          </div>
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
              className="group inline-flex items-center gap-2 px-10 py-4 bg-[#66ccff] text-white rounded-xl font-semibold text-lg shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 hover:bg-[#66ccff]/90"
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

