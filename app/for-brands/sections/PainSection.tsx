'use client'

import { Ghost, Megaphone, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import FadeInView from '@/src/components/for-brands/FadeInView'
import TextReveal from '@/src/components/for-brands/TextReveal'
import StaggerChildren, { staggerItem } from '@/src/components/for-brands/StaggerChildren'

const painPoints = [
  {
    icon: Ghost,
    number: '01',
    title: 'Your leads go cold between launches',
    text: "You close a deal, heads go down, and weeks pass with nothing sent. By the time you resurface, your prospects have moved on to whoever stayed in touch.",
    accent: 'var(--watercolor-rust)',
  },
  {
    icon: Megaphone,
    number: '02',
    title: "You're renting attention you don't own",
    text: "Social reach can vanish overnight. One algorithm change and your audience disappears. You keep paying to deliver the same message to people who already visited your site.",
    accent: 'var(--watercolor-blue-deep)',
  },
  {
    icon: Clock,
    number: '03',
    title: 'Nobody has time to write it every week',
    text: "Your team knows a newsletter would help. But between client work, product, and sales, it keeps getting pushed to next week. Then next month. Then never.",
    accent: 'var(--watercolor-sage)',
  },
]

export default function PainSection() {
  return (
    <section id="the-problem" className="relative overflow-hidden py-28 lg:py-36">
      {/* Subtle dot pattern background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--text-primary) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="container relative mx-auto max-w-[var(--container)] px-6">
        <div className="mb-20 max-w-[700px]">
          <FadeInView>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--watercolor-rust)]/20 bg-[var(--watercolor-rust)]/5 px-4 py-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--watercolor-rust-deep)]">
                Sound familiar?
              </span>
            </div>
          </FadeInView>

          <TextReveal
            as="h2"
            className="mb-6 font-serif font-normal leading-[1.1] tracking-[-0.02em] text-[var(--text-primary)]"
            style={{ fontSize: 'clamp(32px, 4.5vw, 48px)' }}
          >
            You know you should be nurturing leads. But you&apos;re heads-down building.
          </TextReveal>

          <FadeInView delay={0.2}>
            <p className="text-lg leading-[1.8] text-[var(--text-secondary)]">
              Every week without reaching your audience is a week your competitors are
              building the relationship instead.
            </p>
          </FadeInView>
        </div>

        <StaggerChildren className="grid gap-6 lg:grid-cols-3" staggerDelay={0.15}>
          {painPoints.map((pain) => {
            const Icon = pain.icon

            return (
              <motion.article
                key={pain.number}
                variants={staggerItem}
                className="group relative overflow-hidden rounded-2xl border border-[var(--border-light)] bg-white p-8 transition-all duration-500 hover:shadow-[0_8px_40px_rgba(0,0,0,0.06)]"
              >
                {/* Large watermark number */}
                <div
                  className="pointer-events-none absolute right-4 top-2 select-none font-serif text-[clamp(112px,18vw,176px)] font-normal leading-none tracking-[-0.08em] transition-all duration-500 group-hover:scale-105"
                  style={{ color: pain.accent, opacity: 0.06 }}
                >
                  {pain.number}
                </div>

                <div className="relative z-10">
                  <div
                    className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `color-mix(in srgb, ${pain.accent} 12%, transparent)` }}
                  >
                    <Icon size={22} style={{ color: pain.accent }} />
                  </div>

                  <h3 className="mb-3 font-serif text-xl font-normal leading-snug text-[var(--text-primary)]">
                    {pain.title}
                  </h3>

                  <p className="leading-[1.75] text-[var(--text-secondary)]" style={{ fontSize: 'var(--text-body)' }}>
                    {pain.text}
                  </p>
                </div>
              </motion.article>
            )
          })}
        </StaggerChildren>
      </div>
    </section>
  )
}
