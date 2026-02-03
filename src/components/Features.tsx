'use client'
import { Calendar, BookOpen, Wrench, Zap, CheckCircle, BarChart3 } from 'lucide-react';

const features = [
  {
    icon: Calendar,
    title: 'Daily Briefings',
    description: 'Get curated AI news and insights delivered to your inbox every morning. Stay informed without the noise.',
  },
  {
    icon: BookOpen,
    title: 'Research Deep Dives',
    description: 'In-depth analysis of the latest AI research papers and breakthrough technologies from leading institutions.',
  },
  {
    icon: Wrench,
    title: 'Practical Tools',
    description: 'Discover trending AI tools and learn how to implement them in your projects with step-by-step guides.',
  },
  {
    icon: Zap,
    title: 'Quick Insights',
    description: 'Fast-paced updates on industry news, funding rounds, and major announcements in the AI space.',
  },
  {
    icon: CheckCircle,
    title: 'Curated Content',
    description: 'Our team of experts handpicks the most important stories so you only see what matters.',
  },
  {
    icon: BarChart3,
    title: 'Stay Ahead',
    description: 'Be the first to know about emerging trends and opportunities in the rapidly evolving AI landscape.',
  },
];

export default function Features() {
  return (
    <section className="py-24 bg-[var(--bg-warm)] relative">
      <div className="container mx-auto px-6 max-w-[var(--container)]">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="uppercase tracking-[0.22em] font-bold text-[var(--accent-warm)] mb-3" style={{ fontSize: 'var(--text-caption)' }}>
            What You Get
          </div>
          <h2 className="font-serif font-normal leading-[1.12] tracking-[-0.015em] text-[var(--text-primary)] mb-4" style={{ fontSize: 'var(--text-section)' }}>
            Everything You Need to Stay Informed
          </h2>
          <p className="text-[var(--text-secondary)] max-w-[520px] mx-auto leading-[1.7]" style={{ fontSize: 'var(--text-body)' }}>
            Curated intelligence on the rapidly evolving world of artificial intelligence
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const IconComponent = feature.icon;
            return (
              <div
                key={index}
                className="group bg-[var(--bg-card)] p-10 rounded-lg border border-[var(--border-light)] relative overflow-hidden transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              >
                {/* Watercolor accent on hover */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--watercolor-blue)] to-transparent opacity-0 group-hover:opacity-50 transition-opacity duration-250"></div>

                {/* Icon */}
                <div className="relative w-10 h-10 flex items-center justify-center bg-[var(--bg-warm)] rounded mb-6">
                  <div className="absolute inset-[-2px] bg-gradient-to-br from-[var(--watercolor-blue)] to-[var(--watercolor-rust)] opacity-10 rounded z-[-1]"></div>
                  <IconComponent size={20} strokeWidth={2} className="stroke-[var(--text-secondary)]" />
                </div>

                {/* Content */}
                <h3 className="font-semibold text-[var(--text-primary)] mb-2" style={{ fontSize: 'var(--text-card-title)' }}>
                  {feature.title}
                </h3>
                <p className="leading-[1.6] text-[var(--text-secondary)]" style={{ fontSize: 'var(--text-body)' }}>
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
