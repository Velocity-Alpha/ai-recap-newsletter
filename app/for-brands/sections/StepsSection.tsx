'use client'

import { motion } from 'framer-motion'
import FadeInView from '@/components/for-brands/FadeInView'
import TextReveal from '@/components/for-brands/TextReveal'
import StaggerChildren, { staggerItem } from '@/components/for-brands/StaggerChildren'

const steps = [
  {
    step: '01',
    title: 'We learn your business',
    text: "A quick onboarding call. We learn what you sell, who your buyers are, and what the newsletter should do for your pipeline. No homework on your end.",
    detail: 'One call, done',
  },
  {
    step: '02',
    title: 'We build your format',
    text: "We design the sections, tone, visuals, and conversion cards so every issue looks and sounds like your brand. You sign off once.",
    detail: 'Sign off once',
  },
  {
    step: '03',
    title: 'We run it, you review it',
    text: "Every week, you get a draft in your inbox. Five minutes to review and approve. That is the entire time commitment. We handle everything else.",
    detail: '5 min / week',
  },
]

export default function StepsSection() {
  return (
    <section className="relative overflow-hidden bg-[var(--bg-warm)] py-28 lg:py-36">
      {/* Subtle pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%232C3E4A'%3E%3Ccircle cx='30' cy='30' r='1.5'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="container relative mx-auto max-w-[var(--container)] px-6">
        <div className="mb-16 max-w-[720px]">
          <div className="max-w-[640px]">
            <FadeInView>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--watercolor-sage)]/20 bg-[var(--watercolor-sage)]/8 px-4 py-1.5">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                  Getting started
                </span>
              </div>
            </FadeInView>

            <TextReveal
              as="h2"
              className="font-serif font-normal leading-[1.1] tracking-[-0.02em] text-[var(--text-primary)]"
              style={{ fontSize: 'clamp(32px, 4.5vw, 48px)' }}
            >
              Fast onboarding. No homework. Live in days.
            </TextReveal>

            <FadeInView delay={0.2}>
              <p className="mt-5 max-w-[540px] text-lg leading-[1.8] text-[var(--text-secondary)]">
                One onboarding call, then we handle the rest.
              </p>
            </FadeInView>
          </div>
        </div>

        {/* Timeline */}
        <StaggerChildren className="relative" staggerDelay={0.2}>
          {/* Connecting line */}
          <div className="absolute left-8 top-0 hidden h-full w-px bg-gradient-to-b from-[var(--border)] via-[var(--accent-warm)] to-[var(--border)] lg:left-1/2 lg:block" />

          <div className="space-y-6 lg:space-y-0">
            {steps.map((item, index) => (
              <motion.div
                key={item.step}
                variants={staggerItem}
                className={`relative lg:flex lg:items-center lg:gap-12 ${
                  index % 2 === 0 ? '' : 'lg:flex-row-reverse'
                }`}
              >
                {/* Step number circle */}
                <div className="absolute left-8 top-8 z-10 hidden -translate-x-1/2 lg:left-1/2 lg:block">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-[var(--bg-warm)] bg-[var(--watercolor-ink)] font-serif text-sm font-normal text-white shadow-lg">
                    {item.step}
                  </div>
                </div>

                {/* Content card */}
                <div className={`lg:w-[calc(50%-48px)] ${index % 2 === 0 ? 'lg:text-right' : ''}`}>
                  <div className="rounded-2xl border border-[var(--border-light)] bg-white p-8 shadow-[0_2px_20px_rgba(0,0,0,0.03)] transition-all duration-300 hover:shadow-[0_8px_40px_rgba(0,0,0,0.06)]">
                    {/* Mobile step number */}
                    <div className="mb-4 flex items-center gap-3 lg:hidden">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--watercolor-ink)] font-serif text-xs text-white">
                        {item.step}
                      </div>
                      <div className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--accent-warm)]">
                        {item.detail}
                      </div>
                    </div>

                    <div className="hidden text-xs font-bold uppercase tracking-[0.15em] text-[var(--accent-warm)] lg:mb-3 lg:block">
                      {item.detail}
                    </div>

                    <h3 className="mb-3 font-serif text-xl font-normal leading-snug text-[var(--text-primary)]">
                      {item.title}
                    </h3>

                    <p className="leading-[1.75] text-[var(--text-secondary)]" style={{ fontSize: 'var(--text-body)' }}>
                      {item.text}
                    </p>
                  </div>
                </div>

                {/* Spacer for the other side */}
                <div className="hidden lg:block lg:w-[calc(50%-48px)]" />
              </motion.div>
            ))}
          </div>
        </StaggerChildren>
      </div>
    </section>
  )
}
