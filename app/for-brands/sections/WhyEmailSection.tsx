'use client'

import { Mail, BookOpenText } from 'lucide-react'
import FadeInView from '@/src/components/for-brands/FadeInView'

const comparisons = [
  {
    icon: Mail,
    title: 'Owned traffic beats borrowed traffic',
    text: "Every visitor who subscribes is someone you can reach for free, forever. Stop paying to deliver your message to the same people over and over.",
    gradient: 'from-[var(--watercolor-blue)] to-[var(--watercolor-blue-deep)]',
    accentColor: 'var(--watercolor-blue)',
  },
  {
    icon: BookOpenText,
    title: 'Every issue becomes a long-term asset',
    text: "Each newsletter issue lives on your site as a page Google can rank, buyers can discover, and prospects can share. Send once, compound forever.",
    gradient: 'from-[var(--accent-warm)] to-[var(--watercolor-rust-deep)]',
    accentColor: 'var(--accent-warm)',
  },
]

export default function WhyEmailSection() {
  return (
    <section className="relative overflow-hidden py-28 lg:py-36">
      {/* Decorative diagonal lines */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.025]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="absolute h-px bg-[var(--text-primary)]"
            style={{
              width: '200%',
              top: `${10 + i * 12}%`,
              left: '-50%',
              transform: 'rotate(-3deg)',
            }}
          />
        ))}
      </div>

      <div className="container relative mx-auto max-w-[var(--container)] px-6">
        {/* Bold typography hero for this section */}
        <div className="mb-20">
          <FadeInView>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--watercolor-blue)]/20 bg-[var(--watercolor-blue)]/5 px-4 py-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--watercolor-blue-deep)]">
                Why email wins
              </span>
            </div>
          </FadeInView>

          <FadeInView delay={0.1}>
            <h2
              className="max-w-[900px] font-serif font-normal leading-[1.08] tracking-[-0.03em] text-[var(--text-primary)]"
              style={{ fontSize: 'clamp(32px, 5vw, 54px)' }}
            >
              Most marketing disappears the day you post it.{' '}
              <span className="text-[var(--accent-warm)]">This compounds.</span>
            </h2>
          </FadeInView>
        </div>

        {/* Two-card split */}
        <div className="grid gap-6 lg:grid-cols-2">
          {comparisons.map((item, i) => {
            const Icon = item.icon

            return (
              <FadeInView key={item.title} delay={i * 0.15} direction="up">
                <article className="group relative h-full overflow-hidden rounded-3xl border border-[var(--border-light)] bg-white">
                  {/* Gradient top strip */}
                  <div className={`h-1.5 w-full bg-gradient-to-r ${item.gradient}`} />

                  <div className="p-8 lg:p-10">
                    <div
                      className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl"
                      style={{
                        background: `linear-gradient(135deg, color-mix(in srgb, ${item.accentColor} 15%, white), color-mix(in srgb, ${item.accentColor} 8%, white))`,
                      }}
                    >
                      <Icon size={24} className="text-[var(--text-primary)]" />
                    </div>

                    <h3
                      className="mb-4 font-serif font-normal leading-snug text-[var(--text-primary)]"
                      style={{ fontSize: 'clamp(22px, 2.5vw, 28px)' }}
                    >
                      {item.title}
                    </h3>

                    <p className="text-lg leading-[1.8] text-[var(--text-secondary)]">
                      {item.text}
                    </p>
                  </div>
                </article>
              </FadeInView>
            )
          })}
        </div>

        {/* Pull quote */}
        <FadeInView delay={0.3} className="mt-12">
          <div className="relative mx-auto max-w-[700px] text-center">
            <div className="absolute -left-4 -top-4 font-serif text-6xl text-[var(--accent-warm)] opacity-20">
              &ldquo;
            </div>
            <p
              className="font-serif leading-[1.5] text-[var(--text-primary)]"
              style={{ fontSize: 'clamp(18px, 2.2vw, 24px)' }}
            >
              Social posts get buried in hours. Ads stop the moment you stop paying.
              A newsletter builds two assets at once: a list you own and an archive that keeps working.
            </p>
          </div>
        </FadeInView>
      </div>
    </section>
  )
}
