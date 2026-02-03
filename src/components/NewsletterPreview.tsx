'use client'
import { useEffect, useState } from 'react';
import { Newsletter } from '../types/newsletter.types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '../utils/dateFormatter';

export default function NewsletterPreview() {
  const router = useRouter();
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const apiUrl = process.env.NEXT_PUBLIC_NEWSLETTER_URL;
        if (!apiUrl) {
          throw new Error('NEXT_PUBLIC_NEWSLETTER_URL is not set');
        }
        const res = await fetch(`${apiUrl}/fetch-newsletters-list?page=1&limit=3`);
        const data = await res.json();
        setNewsletters(data?.data || []);
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
      <section className="py-20 bg-gradient-to-b from-white to-purple-50/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-muted-foreground">Loading recent newsletters...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-20 bg-gradient-to-b from-white to-purple-50/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Latest Editions
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Explore our most recent AI intelligence briefings
          </p>
        </div>

        {newsletters.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No newsletters available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            {newsletters.map((newsletter) => (
              <div
                key={newsletter.id}
                onClick={() => router.push(`/newsletter/${newsletter.id}`)}
                className="group cursor-pointer bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border border-border/50"
              >
                {/* Image */}
                <div className="relative h-48 overflow-hidden">
                  <img
                    src={newsletter.feature_image_url}
                    alt={newsletter.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-white text-sm font-medium">{formatDate(newsletter.published_at)}</p>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6">
                  <h3 className="text-xl font-bold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {newsletter.title}
                  </h3>
                  <p className="text-muted-foreground text-sm line-clamp-3 mb-4">
                    {newsletter.excerpt}
                  </p>
                  <div className="flex items-center text-primary font-semibold text-sm group-hover:gap-2 transition-all">
                    Read More
                    <span className="ml-1 group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* View All Button */}
        <div className="text-center">
          <Link
            href="/archive"
            className="inline-block px-8 py-3 bg-white text-primary rounded-xl font-semibold border-2 border-primary shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
          >
            View All Editions
          </Link>
        </div>
      </div>
    </section>
  );
}
