'use client'

import { Target, ShieldCheck, Globe, CalendarClock } from 'lucide-react'
import { motion } from 'framer-motion'
import FadeInView from '@/components/for-brands/FadeInView'
import TextReveal from '@/components/for-brands/TextReveal'
import StaggerChildren, { staggerItem } from '@/components/for-brands/StaggerChildren'
import StatsBar from './StatsBar'

const benefits = [
  {
    icon: Target,
    title: 'Book more calls and close more deals',
    text: "Embed conversion cards inside genuinely useful content. Readers click because they already trust you, not because you pushed a cold ad.",
    accent: '#D97706',
    span: 'lg:col-span-2',
  },
  {
    icon: ShieldCheck,
    title: 'Become the authority',
    text: "Show up in their inbox every week with insights they actually want. When they need what you sell, you are the only name that comes to mind.",
    accent: 'var(--watercolor-blue-deep)',
    span: '',
  },
  {
    icon: Globe,
    title: 'Own your audience',
    text: "Your email list belongs to you. No algorithm decides who sees it. When you want to speak to your market, you just send.",
    accent: 'var(--watercolor-sage)',
    span: '',
  },
  {
    icon: CalendarClock,
    title: 'Stay top of mind without lifting a finger',
    text: "No more going dark for weeks and hoping prospects remember you. We keep the relationship warm while you focus on the work that matters.",
    accent: 'var(--accent-warm)',
    span: 'lg:col-span-2',
  },
]

export default function SolutionSection() {
  return (
    <section className="relative overflow-hidden bg-[var(--watercolor-ink)] pb-20 pt-28 lg:pb-24 lg:pt-36">
      {/* Animated gradient accents */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-[10%] top-[20%] h-[500px] w-[500px] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, var(--watercolor-sage) 0%, transparent 70%)',
            animation: 'heroFloat2 22s ease-in-out infinite',
          }}
        />
        <div
          className="absolute -right-[5%] bottom-[10%] h-[400px] w-[400px] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, var(--accent-warm) 0%, transparent 70%)',
            animation: 'heroFloat1 18s ease-in-out infinite',
          }}
        />
      </div>

      <div className="container relative z-10 mx-auto max-w-[var(--container)] px-6">
        <div className="mb-16 max-w-[700px]">
          <FadeInView>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--watercolor-sage)]">
                The fix
              </span>
            </div>
          </FadeInView>

          <TextReveal
            as="h2"
            className="mb-6 font-serif font-normal leading-[1.1] tracking-[-0.02em] text-white"
            style={{ fontSize: 'clamp(32px, 4.5vw, 48px)' }}
          >
            A newsletter that runs itself. In your voice. For your market.
          </TextReveal>

          <FadeInView delay={0.2}>
            <p className="text-lg leading-[1.8] text-white/60">
              Every issue teaches something useful and gently drives action. You stay
              focused on the work that actually needs you.
            </p>
          </FadeInView>
        </div>

        {/* Bento grid */}
        <StaggerChildren className="grid gap-4 lg:grid-cols-3" staggerDelay={0.1}>
          {benefits.map((benefit) => {
            const Icon = benefit.icon

            return (
              <motion.article
                key={benefit.title}
                variants={staggerItem}
                className={`group relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04] p-8 backdrop-blur-sm transition-all duration-500 hover:border-white/15 hover:bg-white/[0.07] ${benefit.span}`}
              >
                <div
                  className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `color-mix(in srgb, ${benefit.accent} 20%, transparent)` }}
                >
                  <Icon size={20} style={{ color: benefit.accent }} />
                </div>

                <h3 className="mb-3 font-serif text-xl font-normal leading-snug text-white">
                  {benefit.title}
                </h3>

                <p className="leading-[1.75] text-white/55" style={{ fontSize: 'var(--text-body)' }}>
                  {benefit.text}
                </p>

                {/* Hover accent line */}
                <div
                  className="absolute bottom-0 left-0 h-[2px] w-0 transition-all duration-700 group-hover:w-full"
                  style={{ backgroundColor: benefit.accent }}
                />
              </motion.article>
            )
          })}
        </StaggerChildren>

        <StatsBar className="mt-12 lg:mt-16" />
      </div>
    </section>
  )
}
