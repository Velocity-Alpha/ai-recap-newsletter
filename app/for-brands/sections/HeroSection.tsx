'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import TextReveal from '@/components/for-brands/TextReveal'
import FadeInView from '@/components/for-brands/FadeInView'

const PROOF_POINTS = [
  { label: 'Your time', value: '5-min review' },
  { label: 'Your voice', value: 'Your brand' },
  { label: 'Delivered', value: 'Every week' },
]

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[var(--watercolor-ink)]">
      {/* Soft gradient blobs */}
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
        {/* Badge */}
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

        {/* Headline */}
        <TextReveal
          as="h1"
          className="mb-6 max-w-[720px] font-serif font-normal leading-[1.08] tracking-[-0.025em] text-white"
          style={{ fontSize: 'clamp(40px, 5vw, 64px)' }}
        >
          We run your branded newsletter,{' '}
          <span className="italic text-[var(--accent-warm)]">end to end.</span>
        </TextReveal>

        {/* Subhead */}
        <FadeInView delay={0.3}>
          <p className="mb-10 max-w-[560px] text-xl leading-[1.7] text-white/90">
            Your audience hears from you every week with content worth reading.
            We write it, design it, send it — you review and approve.
          </p>
        </FadeInView>

        {/* Proof strip */}
        <FadeInView delay={0.4}>
          <div className="mb-10 flex flex-wrap gap-3">
            {PROOF_POINTS.map(({ label, value }) => (
              <div
                key={label}
                className="rounded-xl border border-white/12 bg-white/[0.06] px-5 py-3 backdrop-blur-sm"
              >
                <div className="mb-0.5 text-xs font-semibold uppercase tracking-[0.15em] text-white/45">{label}</div>
                <div className="font-serif text-base text-white">{value}</div>
              </div>
            ))}
          </div>
        </FadeInView>

        {/* CTA */}
        <FadeInView delay={0.55}>
          <Link
            href="#contact"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 font-semibold text-[var(--watercolor-ink)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
          >
            Start your newsletter
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </FadeInView>
      </div>
    </section>
  )
}
