'use client'
import { Calendar, BookOpen, Wrench, Zap, CheckCircle, BarChart3 } from 'lucide-react';

const features = [
  {
    icon: Calendar,
    title: 'Morning Briefing',
    description: 'A calm, short read that lands with your coffee. Just the signal. No noise.',
  },
  {
    icon: BookOpen,
    title: 'Research, distilled',
    description: 'We read the papers. You get the practical takeaways.',
  },
  {
    icon: Wrench,
    title: 'Tools, tested',
    description: 'Hands-on notes: what works, what breaks, what it costs.',
  },
  {
    icon: Zap,
    title: 'Industry pulse',
    description: 'Funding, policy, and platform shifts distilled to a few readable lines.',
  },
  {
    icon: CheckCircle,
    title: 'Curated, not crowded',
    description: 'Every item earns its place. No link dumps, no filler, no recycled takes.',
  },
  {
    icon: BarChart3,
    title: 'Ahead, not anxious',
    description: 'Stay oriented. We map the week, you keep momentum.',
  },
];

export default function Features() {
  return (
    <section className="py-24 bg-[var(--bg-warm)] relative">
      <div className="container mx-auto px-6 max-w-[var(--container)]">
        {/* Section Header */}
        <div className="text-center mb-16">
          <div className="uppercase tracking-[0.22em] font-bold text-[var(--accent-warm)] mb-3" style={{ fontSize: 'var(--text-caption)' }}>
            The Brief
          </div>
          <h2 className="font-serif font-normal leading-[1.12] tracking-[-0.015em] text-[var(--text-primary)] mb-4" style={{ fontSize: 'var(--text-section)' }}>
            A daily briefing for people who build
          </h2>
          <p className="text-[var(--text-secondary)] max-w-[600px] mx-auto leading-[1.7]" style={{ fontSize: 'var(--text-body)' }}>
            A tight, readable summary of the stories, papers, and tools shaping the week in AI.
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
