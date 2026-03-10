'use client'

import FadeInView from '@/src/components/for-brands/FadeInView'
import TextReveal from '@/src/components/for-brands/TextReveal'
import ForBrandsContactForm from '@/src/components/ForBrandsContactForm'

export default function CtaSection() {
  return (
    <section
      id="contact"
      className="relative overflow-hidden bg-[var(--watercolor-ink)] py-28 lg:py-36"
    >
      {/* Soft radial glow blobs instead of hard gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-[-5%] top-[-10%] h-[700px] w-[700px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(168,197,217,0.12) 0%, transparent 65%)',
            filter: 'blur(80px)',
            animation: 'heroFloat1 18s ease-in-out infinite',
          }}
        />
        <div
          className="absolute bottom-[-15%] right-[-10%] h-[800px] w-[800px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(184,133,110,0.1) 0%, transparent 60%)',
            filter: 'blur(100px)',
            animation: 'heroFloat2 22s ease-in-out infinite',
          }}
        />
        <div
          className="absolute bottom-[20%] left-[30%] h-[400px] w-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(157,180,160,0.08) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animation: 'heroFloat3 15s ease-in-out infinite',
          }}
        />
      </div>

      <div className="container relative z-10 mx-auto max-w-[var(--container)] px-6">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="max-w-[560px]">
            <FadeInView>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-1.5">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">
                  Let&apos;s talk
                </span>
              </div>
            </FadeInView>

            <TextReveal
              as="h2"
              className="mb-6 font-serif font-normal leading-[1.1] tracking-[-0.02em] text-white"
              style={{ fontSize: 'clamp(30px, 4vw, 46px)' }}
            >
              Every week you&apos;re not in their inbox, someone else is.
            </TextReveal>

            <FadeInView delay={0.2}>
              <p className="text-lg leading-[1.8] text-white/60">
                Tell us about your business, your audience, and what you want the newsletter
                to do. We will show you exactly how we would shape it for your market.
              </p>
            </FadeInView>

            <FadeInView delay={0.3}>
              <p className="mt-5 leading-[1.8] text-white/50" style={{ fontSize: 'var(--text-body)' }}>
                Finance, health, real estate, SaaS, professional services, or something else
                entirely. The newsletter is built around your world, not ours.
              </p>
            </FadeInView>

            <FadeInView delay={0.4} className="mt-8">
              <div className="rounded-xl border border-white/8 bg-white/[0.04] p-5 backdrop-blur-sm">
                <p className="text-sm leading-relaxed text-white/70">
                  <span className="font-semibold text-white/90">No commitment required.</span>{' '}
                  Fill out the form and we will get back to you with a clear picture of what
                  your newsletter could look like.
                </p>
              </div>
            </FadeInView>
          </div>

          <FadeInView delay={0.2} direction="right">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-7 shadow-[0_4px_60px_rgba(0,0,0,0.2)] backdrop-blur-md">
              <ForBrandsContactForm />
            </div>
          </FadeInView>
        </div>
      </div>
    </section>
  )
}
