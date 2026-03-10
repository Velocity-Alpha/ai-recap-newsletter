import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpenText,
  CalendarClock,
  Clock,
  Ghost,
  Globe,
  Mail,
  Megaphone,
  ShieldCheck,
  Target,
} from 'lucide-react'

import Footer from '@/src/components/Footer'
import ForBrandsContactForm from '@/src/components/ForBrandsContactForm'
import Header from '@/src/components/Header'
import ScrollAnimation from '@/src/components/ScrollAnimation'

export const metadata: Metadata = {
  title: 'For Brands | AI Recap',
  description:
    'Your prospects are forgetting about you between deals. We build and run a branded newsletter that keeps you top of mind, books more calls, and grows search traffic. Five-minute review, not a five-hour scramble.',
}

const painPoints = [
  {
    icon: Ghost,
    title: 'Your leads go cold between launches',
    text: "You close a deal, heads go down, and weeks pass with nothing sent. By the time you resurface, your prospects have moved on to whoever stayed in touch.",
  },
  {
    icon: Megaphone,
    title: "You're renting attention you don't own",
    text: "Social reach can vanish overnight. One algorithm change and your audience disappears. You keep paying to deliver the same message to people who already visited your site.",
  },
  {
    icon: Clock,
    title: "Nobody has time to write it every week",
    text: "Your team knows a newsletter would help. But between client work, product, and sales, it keeps getting pushed to next week. Then next month. Then never.",
  },
]

const solutionBenefits = [
  {
    icon: Target,
    title: 'Book more calls and close more deals',
    text: "Embed conversion cards inside genuinely useful content. Readers click because they already trust you, not because you pushed a cold ad.",
  },
  {
    icon: ShieldCheck,
    title: 'Become the authority in your space',
    text: "Show up in their inbox every week with insights they actually want. When they need what you sell, you are the only name that comes to mind.",
  },
  {
    icon: Globe,
    title: "Build an audience you actually own",
    text: "Your email list belongs to you. No algorithm decides who sees it. When you want to speak to your market, you just send.",
  },
  {
    icon: CalendarClock,
    title: 'Stay top of mind without lifting a finger',
    text: "No more going dark for weeks and hoping prospects remember you. We keep the relationship warm while you focus on the work that matters.",
  },
]

const lessons = [
  {
    icon: Mail,
    title: 'Owned traffic beats borrowed traffic',
    text: "Every visitor who subscribes is someone you can reach for free, forever. Stop paying to deliver your message to the same people over and over. Capture them once and stay connected on your terms.",
  },
  {
    icon: BookOpenText,
    title: 'Every issue becomes a long-term asset',
    text: "Most marketing disappears the day you post it. Each newsletter issue lives on your site as a page Google can rank, buyers can discover, and prospects can share. Send once, compound forever.",
  },
]

const steps = [
  {
    step: '01',
    title: 'We learn your business',
    text: "A quick onboarding call. We learn what you sell, who your buyers are, and what the newsletter should do for your pipeline. No homework on your end.",
  },
  {
    step: '02',
    title: 'We build your format',
    text: "We design the sections, tone, visuals, and conversion cards so every issue looks and sounds like your brand. You sign off once.",
  },
  {
    step: '03',
    title: 'We run it, you review it',
    text: "Every week, you get a draft in your inbox. Five minutes to review and approve. That is the entire time commitment. We handle everything else.",
  },
]

export default function ForBrandsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      <Header />

      <main>
        <section className="relative overflow-hidden border-b border-[var(--border-light)] bg-[var(--bg-card)]">
          <div
            className="watercolor-blob left-[-120px] top-8 h-[320px] w-[320px] bg-[var(--watercolor-blue)]"
            style={{ filter: 'blur(96px)', opacity: 0.1 }}
          />
          <div
            className="watercolor-blob bottom-[-120px] right-[-80px] h-[300px] w-[300px] bg-[var(--watercolor-rust)]"
            style={{ filter: 'blur(96px)', opacity: 0.08 }}
          />

          <div className="container relative z-10 mx-auto max-w-[var(--container)] px-6 py-20 lg:py-28">
            <div className="grid items-center gap-12 lg:grid-cols-[1fr_0.92fr]">
              <ScrollAnimation className="max-w-[640px]" animationType="slide-left">
                <div
                  className="mb-5 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  For brands &amp; businesses
                </div>

                <h1
                  className="mb-6 font-serif font-normal leading-[1.08] tracking-[-0.025em] text-[var(--text-primary)]"
                  style={{ fontSize: 'clamp(40px, 6vw, 62px)' }}
                >
                  Your best prospects are forgetting about you right now.
                </h1>

                <p
                  className="max-w-[58ch] leading-[1.8] text-[var(--text-secondary)]"
                  style={{ fontSize: 'calc(var(--text-body) * 1.04)' }}
                >
                  Between deals and launches, your audience goes cold. A branded newsletter
                  keeps you in their inbox every week, building trust that turns into calls,
                  revenue, and referrals. We build it, write it, and run it for you.
                </p>

                <p
                  className="mt-5 max-w-[58ch] leading-[1.8] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  Your five-minute weekly review is the only commitment. We handle everything else.
                </p>

                <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                  <Link
                    href="#contact"
                    className="inline-flex items-center justify-center rounded border border-[var(--text-primary)] bg-[var(--text-primary)] px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--watercolor-ink)]"
                  >
                    Start your newsletter
                  </Link>

                  <Link
                    href="#the-problem"
                    className="inline-flex items-center justify-center gap-2 rounded border border-[var(--border)] bg-transparent px-6 py-3 font-semibold text-[var(--text-primary)] transition-colors duration-200 hover:border-[var(--text-primary)] hover:bg-[var(--bg-warm)]"
                  >
                    See how it works
                    <ArrowRight size={16} />
                  </Link>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-3">
                  {[
                    ['More revenue', 'Conversion cards inside every issue drive calls and sales.'],
                    ['Zero writing', 'Review a finished draft. Never write from scratch.'],
                    ['Compounds over time', 'Every issue becomes a page that ranks in search.'],
                  ].map(([title, text]) => (
                    <div
                      key={title}
                      className="rounded-xl border border-[var(--border-light)] bg-[rgba(255,255,255,0.78)] px-4 py-4"
                    >
                      <div
                        className="mb-2 font-serif text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-card-title) * 0.98)' }}
                      >
                        {title}
                      </div>
                      <p
                        className="leading-[1.6] text-[var(--text-secondary)]"
                        style={{ fontSize: 'var(--text-small)' }}
                      >
                        {text}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollAnimation>

              <ScrollAnimation animationType="slide-right" delay={90}>
                <div className="rounded-[28px] border border-[var(--border-light)] bg-[rgba(250,250,248,0.92)] p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_rgba(61,79,95,0.08)]">
                  <div className="flex items-center justify-between border-b border-[var(--border-light)] pb-5">
                    <div>
                      <div
                        className="font-bold uppercase tracking-[0.18em] text-[var(--accent-warm)]"
                        style={{ fontSize: 'var(--text-caption)' }}
                      >
                        What changes
                      </div>
                      <h2
                        className="mt-2 font-serif font-normal leading-[1.25] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-section) * 0.8)' }}
                      >
                        From invisible to indispensable in your market
                      </h2>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4">
                    {[
                      'Prospects hear from you every week with content worth reading.',
                      'Soft CTAs inside each issue generate leads while you sleep.',
                      'A growing archive of content that ranks in search and builds credibility.',
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex gap-4 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] px-4 py-4"
                      >
                        <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--watercolor-sage)]" />
                        <p
                          className="leading-[1.7] text-[var(--text-secondary)]"
                          style={{ fontSize: 'var(--text-body)' }}
                        >
                          {item}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-card)] p-5">
                      <div
                        className="mb-2 font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]"
                        style={{ fontSize: 'var(--text-caption)' }}
                      >
                        Your time
                      </div>
                      <p
                        className="font-serif leading-[1.45] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-card-title) * 1.05)' }}
                      >
                        5 minutes to review. Not 5 hours to write.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-warm)] p-5">
                      <div
                        className="mb-2 font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]"
                        style={{ fontSize: 'var(--text-caption)' }}
                      >
                        Your brand
                      </div>
                      <p
                        className="font-serif leading-[1.45] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-card-title) * 1.05)' }}
                      >
                        Your voice. Your niche. Your audience. We just run it.
                      </p>
                    </div>
                  </div>
                </div>
              </ScrollAnimation>
            </div>
          </div>
        </section>

        <section id="the-problem" className="bg-[var(--bg-main)] py-24">
          <div className="container mx-auto max-w-[var(--container)] px-6">
            <ScrollAnimation className="mb-14 max-w-[720px]">
              <div
                className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                style={{ fontSize: 'var(--text-caption)' }}
              >
                Sound familiar?
              </div>
              <h2
                className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                style={{ fontSize: 'var(--text-section)' }}
              >
                You know you should be nurturing leads. But you are heads-down building.
              </h2>
              <p
                className="leading-[1.75] text-[var(--text-secondary)]"
                style={{ fontSize: 'var(--text-body)' }}
              >
                Every week that goes by without reaching your audience is a week your
                competitors are building the relationship instead. The problem is not that you
                lack ideas. It is that nobody has time to turn them into a consistent newsletter.
              </p>
            </ScrollAnimation>

            <div className="grid gap-6 md:grid-cols-3">
              {painPoints.map((pain, index) => {
                const Icon = pain.icon

                return (
                  <ScrollAnimation
                    key={pain.title}
                    animationType="fade-in"
                    delay={index * 80}
                  >
                    <article className="h-full rounded-[24px] border border-[var(--border-light)] bg-[var(--bg-card)] p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_26px_rgba(61,79,95,0.04)]">
                      <div className="relative mb-6 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--bg-warm)]">
                        <div className="absolute inset-[-2px] rounded-lg bg-gradient-to-br from-[var(--watercolor-blue)] to-[var(--watercolor-rust)] opacity-15" />
                        <Icon size={20} className="relative text-[var(--text-secondary)]" />
                      </div>

                      <h3
                        className="mb-3 font-serif font-normal leading-[1.3] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-card-title) * 1.08)' }}
                      >
                        {pain.title}
                      </h3>

                      <p
                        className="leading-[1.7] text-[var(--text-secondary)]"
                        style={{ fontSize: 'var(--text-body)' }}
                      >
                        {pain.text}
                      </p>
                    </article>
                  </ScrollAnimation>
                )
              })}
            </div>
          </div>
        </section>

        <section className="bg-[var(--bg-warm)] py-24">
          <div className="container mx-auto max-w-[var(--container)] px-6">
            <ScrollAnimation className="mb-14 max-w-[720px]">
              <div
                className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                style={{ fontSize: 'var(--text-caption)' }}
              >
                The fix
              </div>
              <h2
                className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                style={{ fontSize: 'var(--text-section)' }}
              >
                A newsletter that runs itself. In your voice. For your market.
              </h2>
              <p
                className="leading-[1.75] text-[var(--text-secondary)]"
                style={{ fontSize: 'var(--text-body)' }}
              >
                We build a branded newsletter around your niche, your buyers, and your offers.
                Every issue teaches something useful and gently drives action. You stay
                focused on the work that actually needs you.
              </p>
            </ScrollAnimation>

            <div className="grid gap-6 md:grid-cols-2">
              {solutionBenefits.map((benefit, index) => {
                const Icon = benefit.icon

                return (
                  <ScrollAnimation
                    key={benefit.title}
                    animationType="fade-in"
                    delay={index * 80}
                  >
                    <article className="h-full rounded-[24px] border border-[var(--border-light)] bg-[var(--bg-card)] p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_26px_rgba(61,79,95,0.04)]">
                      <div className="flex items-start gap-4">
                        <div className="relative mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-warm)]">
                          <div className="absolute inset-[-2px] rounded-lg bg-gradient-to-br from-[var(--watercolor-blue)] to-[var(--watercolor-rust)] opacity-15" />
                          <Icon size={20} className="relative text-[var(--text-secondary)]" />
                        </div>

                        <div>
                          <h3
                            className="mb-2 font-serif font-normal leading-[1.3] text-[var(--text-primary)]"
                            style={{ fontSize: 'calc(var(--text-card-title) * 1.08)' }}
                          >
                            {benefit.title}
                          </h3>

                          <p
                            className="leading-[1.7] text-[var(--text-secondary)]"
                            style={{ fontSize: 'var(--text-body)' }}
                          >
                            {benefit.text}
                          </p>
                        </div>
                      </div>
                    </article>
                  </ScrollAnimation>
                )
              })}
            </div>
          </div>
        </section>

        <section className="bg-[var(--bg-card)] py-24">
          <div className="container mx-auto max-w-[var(--container)] px-6">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <ScrollAnimation className="max-w-[560px]" animationType="slide-left">
                <div
                  className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  Why email wins
                </div>
                <h2
                  className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  Most marketing disappears the day you post it. This compounds.
                </h2>
                <p
                  className="leading-[1.75] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  Social posts get buried in hours. Ads stop the moment you stop paying.
                  A newsletter builds two assets at once: an email list you own and a search-optimized
                  archive that keeps working months after every send.
                </p>
              </ScrollAnimation>

              <div className="grid gap-4">
                {lessons.map((lesson, index) => {
                  const Icon = lesson.icon

                  return (
                    <ScrollAnimation
                      key={lesson.title}
                      animationType="fade-in"
                      delay={index * 90}
                    >
                      <article className="rounded-[22px] border border-[var(--border-light)] bg-[var(--bg-main)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_22px_rgba(61,79,95,0.04)]">
                        <div className="flex items-start gap-4">
                          <div className="relative mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-warm)]">
                            <div className="absolute inset-[-1px] rounded-lg bg-[rgba(168,197,217,0.18)]" />
                            <Icon size={18} className="relative text-[var(--text-secondary)]" />
                          </div>

                          <div>
                            <h3
                              className="mb-2 font-serif font-normal leading-[1.3] text-[var(--text-primary)]"
                              style={{ fontSize: 'calc(var(--text-card-title) * 1.02)' }}
                            >
                              {lesson.title}
                            </h3>

                            <p
                              className="leading-[1.7] text-[var(--text-secondary)]"
                              style={{ fontSize: 'var(--text-body)' }}
                            >
                              {lesson.text}
                            </p>
                          </div>
                        </div>
                      </article>
                    </ScrollAnimation>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[var(--bg-main)] py-24">
          <div className="container mx-auto max-w-[var(--container)] px-6">
            <div className="grid items-start gap-10 lg:grid-cols-[0.88fr_1.12fr]">
              <ScrollAnimation className="max-w-[520px]" animationType="slide-left">
                <div
                  className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  Getting started
                </div>
                <h2
                  className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  Fast onboarding. No homework. You could be live in weeks.
                </h2>
                <p
                  className="leading-[1.75] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  We do the heavy lifting so you can stay focused on the work that actually
                  needs you. One call to get started, then we take it from there.
                </p>
              </ScrollAnimation>

              <div className="grid gap-5">
                {steps.map((item, index) => (
                  <ScrollAnimation
                    key={item.step}
                    animationType="fade-in"
                    delay={index * 90}
                  >
                    <article className="rounded-[22px] border border-[var(--border-light)] bg-[var(--bg-card)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_22px_rgba(61,79,95,0.04)]">
                      <div className="flex items-start gap-5">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-warm)] font-serif text-[var(--text-primary)]">
                          {item.step}
                        </div>
                        <div>
                          <h3
                            className="mb-2 font-serif font-normal leading-[1.3] text-[var(--text-primary)]"
                            style={{ fontSize: 'calc(var(--text-card-title) * 1.06)' }}
                          >
                            {item.title}
                          </h3>
                          <p
                            className="leading-[1.7] text-[var(--text-secondary)]"
                            style={{ fontSize: 'var(--text-body)' }}
                          >
                            {item.text}
                          </p>
                        </div>
                      </div>
                    </article>
                  </ScrollAnimation>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          id="contact"
          className="relative overflow-hidden py-24"
          style={{
            background:
              'radial-gradient(circle at 12% 50%, rgba(168,197,217,0.14) 0%, rgba(168,197,217,0) 34%), linear-gradient(180deg, #496176 0%, #3D4F5F 100%)',
          }}
        >

          <div className="container relative z-10 mx-auto max-w-[var(--container)] px-6">
            <div className="grid items-start gap-10 lg:grid-cols-[0.88fr_1.12fr]">
              <ScrollAnimation className="max-w-[520px]" animationType="slide-left">
                <div
                  className="mb-3 font-bold uppercase tracking-[0.22em] text-white/65"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  Let&apos;s talk
                </div>
                <h2
                  className="font-serif font-normal leading-[1.16] text-white"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  Every week you are not in their inbox, someone else is.
                </h2>
                <p
                  className="mt-5 max-w-[540px] leading-[1.8] text-white/72"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  Tell us about your business, your audience, and what you want the newsletter
                  to do. We will show you exactly how we would shape it for your market.
                </p>
                <p
                  className="mt-5 max-w-[540px] leading-[1.8] text-white/72"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  Finance, health, real estate, SaaS, professional services, or something else
                  entirely. The newsletter is built around your world, not ours.
                </p>
                <div className="mt-8 rounded-xl border border-white/12 bg-white/6 p-5">
                  <p
                    className="font-serif leading-[1.5] text-white/90"
                    style={{ fontSize: 'calc(var(--text-body) * 1.02)' }}
                  >
                    No commitment required. Fill out the form and we will get back to you
                    with a clear picture of what your newsletter could look like.
                  </p>
                </div>
              </ScrollAnimation>

              <ScrollAnimation animationType="slide-right" delay={90}>
                <div className="rounded-[24px] border border-white/12 bg-white/6 p-7 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_18px_42px_rgba(18,31,41,0.22)] backdrop-blur-sm">
                  <ForBrandsContactForm />
                </div>
              </ScrollAnimation>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
