'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import TextReveal from '@/src/components/for-brands/TextReveal'
import FadeInView from '@/src/components/for-brands/FadeInView'

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[var(--watercolor-ink)]">
      {/* Soft gradient blobs only - no grid overlay */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-[-10%] top-[-10%] h-[60%] w-[60%] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(168,197,217,0.18) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animation: 'heroFloat1 20s ease-in-out infinite',
          }}
        />
        <div
          className="absolute bottom-[-20%] right-[-10%] h-[70%] w-[70%] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(184,133,110,0.15) 0%, transparent 70%)',
            filter: 'blur(100px)',
            animation: 'heroFloat2 25s ease-in-out infinite',
          }}
        />
        <div
          className="absolute left-[40%] top-[20%] h-[40%] w-[40%] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(157,180,160,0.12) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animation: 'heroFloat3 18s ease-in-out infinite',
          }}
        />
      </div>

      <div className="container relative z-10 mx-auto max-w-[var(--container)] px-6 pb-28 pt-28 lg:pb-36 lg:pt-36">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          {/* Left column - copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 backdrop-blur-sm"
            >
              <div className="h-2 w-2 rounded-full bg-[var(--watercolor-sage)]" style={{ animation: 'livePulse 2s ease-in-out infinite' }} />
              <span className="text-sm font-medium tracking-wide text-white/80">
                For brands &amp; businesses
              </span>
            </motion.div>

            <TextReveal
              as="h1"
              className="mb-8 font-serif font-normal leading-[1.08] tracking-[-0.025em] text-white"
              style={{ fontSize: 'clamp(36px, 4.5vw, 56px)' }}
            >
              Your best prospects are forgetting about you right now.
            </TextReveal>

            <FadeInView delay={0.3} className="max-w-[540px]">
              <p className="text-lg leading-[1.8] text-white/70">
                Between deals and launches, your audience goes cold. A branded newsletter
                keeps you in their inbox every week, building trust that turns into calls,
                revenue, and referrals.
              </p>
            </FadeInView>

            <FadeInView delay={0.5}>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link
                  href="#contact"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 font-semibold text-[var(--watercolor-ink)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
                >
                  Start your newsletter
                  <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
                </Link>

                <Link
                  href="#the-problem"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-8 py-4 font-semibold text-white/90 transition-all duration-300 hover:border-white/40 hover:bg-white/5"
                >
                  See how it works
                </Link>
              </div>
            </FadeInView>
          </div>

          {/* Right column - what changes card */}
          <FadeInView delay={0.4} direction="right" className="hidden lg:block">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-8 backdrop-blur-md">
              <div className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent-warm)]">
                What changes
              </div>
              <div className="space-y-5">
                {[
                  'Prospects hear from you every week with content worth reading.',
                  'Soft CTAs inside each issue generate leads while you sleep.',
                  'A growing archive of content that ranks in search.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <div className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--watercolor-sage)]" />
                    <span className="leading-relaxed text-white/65" style={{ fontSize: 'var(--text-body)' }}>{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/8 bg-white/[0.04] px-5 py-4">
                  <div className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-white/40">Your time</div>
                  <div className="font-serif text-xl text-white/85">5 min review</div>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.04] px-5 py-4">
                  <div className="mb-1 text-xs font-bold uppercase tracking-[0.15em] text-white/40">Your brand</div>
                  <div className="font-serif text-xl text-white/85">Your voice</div>
                </div>
              </div>
            </div>
          </FadeInView>
        </div>

        <FadeInView delay={0.7} className="mt-14">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/35">
            We handle everything. You review for 5 minutes.
          </p>
        </FadeInView>
      </div>
    </section>
  )
}
