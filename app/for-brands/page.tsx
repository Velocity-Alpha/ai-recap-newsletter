import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpenText,
  BriefcaseBusiness,
  Mail,
  Search,
  ShieldCheck,
} from 'lucide-react'

import Footer from '@/src/components/Footer'
import ForBrandsContactForm from '@/src/components/ForBrandsContactForm'
import Header from '@/src/components/Header'
import ScrollAnimation from '@/src/components/ScrollAnimation'

export const metadata: Metadata = {
  title: 'For Brands | AI Recap',
  description:
    'Done-for-you custom newsletters for brands that want more trust, more leads, and more search traffic without making the team write every week.',
}

const benefits = [
  {
    icon: BriefcaseBusiness,
    title: 'Stay top of mind',
    text: 'A good newsletter gives people a reason to hear from you every week, not only when you launch something.',
  },
  {
    icon: Mail,
    title: 'Get more leads',
    text: 'Useful emails build trust. Small offers inside them can turn readers into replies, calls, and sales.',
  },
  {
    icon: Search,
    title: 'Grow search traffic',
    text: 'Each issue can live on your site. Over time, your archive gives Google more pages to rank.',
  },
]

const lessons = [
  {
    icon: ShieldCheck,
    title: 'Why email works better than social',
    text: 'Social reach can disappear overnight. Your email list is yours. When you want to speak to your market, you can just send.',
  },
  {
    icon: BookOpenText,
    title: 'Why the archive matters',
    text: 'An archive is not just a nice extra. It is a long-term growth engine. Every issue becomes a page people can find, read, share, and trust.',
  },
]

const steps = [
  {
    step: '01',
    title: 'We learn the business',
    text: 'We look at what you sell, who you want to reach, and what the newsletter should help you do.',
  },
  {
    step: '02',
    title: 'We build the format',
    text: 'We set the sections, tone, look, and call to action so each issue feels clear and on-brand.',
  },
  {
    step: '03',
    title: 'We run it for you',
    text: 'We handle the work. Your team gives notes, approves fast, and stays focused on the bigger jobs.',
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
                  For brands
                </div>

                <h1
                  className="mb-6 font-serif font-normal leading-[1.08] tracking-[-0.025em] text-[var(--text-primary)]"
                  style={{ fontSize: 'clamp(40px, 6vw, 62px)' }}
                >
                  Get a custom newsletter on your topic that brings leads, trust, and search traffic.
                </h1>

                <p
                  className="max-w-[58ch] leading-[1.8] text-[var(--text-secondary)]"
                  style={{ fontSize: 'calc(var(--text-body) * 1.04)' }}
                >
                  We plan it, write it, and publish it for you. Your team reviews it in minutes
                  instead of trying to build the whole thing every week.
                </p>

                <p
                  className="mt-5 max-w-[58ch] leading-[1.8] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  This is built around your market, your buyers, and your offer. It does not need
                  to be about AI unless AI is your topic.
                </p>

                <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                  <Link
                    href="#contact"
                    className="inline-flex items-center justify-center rounded border border-[var(--text-primary)] bg-[var(--text-primary)] px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-[var(--watercolor-ink)]"
                  >
                    Get in touch
                  </Link>

                  <Link
                    href="#learn-more"
                    className="inline-flex items-center justify-center gap-2 rounded border border-[var(--border)] bg-transparent px-6 py-3 font-semibold text-[var(--text-primary)] transition-colors duration-200 hover:border-[var(--text-primary)] hover:bg-[var(--bg-warm)]"
                  >
                    Learn more
                    <ArrowRight size={16} />
                  </Link>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-3">
                  {[
                    ['More trust', 'Show up often with something worth reading.'],
                    ['More leads', 'Place simple offers inside useful content.'],
                    ['Less work', 'Review instead of writing from scratch.'],
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
                        What you get
                      </div>
                      <h2
                        className="mt-2 font-serif font-normal leading-[1.25] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-section) * 0.8)' }}
                      >
                        A real newsletter on your topic, not another task on the list
                      </h2>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4">
                    {[
                      'A clear format built for your niche and your buyers.',
                      'Useful issues that teach, build trust, and create demand.',
                      'A growing archive that keeps working after each send.',
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
                        Time saved
                      </div>
                      <p
                        className="font-serif leading-[1.45] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-card-title) * 1.05)' }}
                      >
                        Five-minute review, not five-hour scramble.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--bg-warm)] p-5">
                      <div
                        className="mb-2 font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]"
                        style={{ fontSize: 'var(--text-caption)' }}
                      >
                        Long-term value
                      </div>
                      <p
                        className="font-serif leading-[1.45] text-[var(--text-primary)]"
                        style={{ fontSize: 'calc(var(--text-card-title) * 1.05)' }}
                      >
                        Each issue adds another useful page to your site.
                      </p>
                    </div>
                  </div>
                </div>
              </ScrollAnimation>
            </div>
          </div>
        </section>

        <section id="learn-more" className="bg-[var(--bg-main)] py-24">
          <div className="container mx-auto max-w-[var(--container)] px-6">
            <ScrollAnimation className="mb-14 max-w-[720px]">
              <div
                className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                style={{ fontSize: 'var(--text-caption)' }}
              >
                Main benefits
              </div>
              <h2
                className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                style={{ fontSize: 'var(--text-section)' }}
              >
                The best part is what you get without the weekly work.
              </h2>
              <p
                className="leading-[1.75] text-[var(--text-secondary)]"
                style={{ fontSize: 'var(--text-body)' }}
              >
                A strong newsletter can grow your brand, help sales, and bring in search traffic.
                It should not eat the whole week to do that.
              </p>
            </ScrollAnimation>

            <div className="grid gap-6 md:grid-cols-3">
              {benefits.map((benefit, index) => {
                const Icon = benefit.icon

                return (
                  <ScrollAnimation
                    key={benefit.title}
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
                        {benefit.title}
                      </h3>

                      <p
                        className="leading-[1.7] text-[var(--text-secondary)]"
                        style={{ fontSize: 'var(--text-body)' }}
                      >
                        {benefit.text}
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
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <ScrollAnimation className="max-w-[560px]" animationType="slide-left">
                <div
                  className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  Why this works
                </div>
                <h2
                  className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  A good newsletter teaches first, then sells.
                </h2>
                <p
                  className="leading-[1.75] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  When people learn from you on a regular basis, they trust you more. That makes
                  the sale easier. You do not have to force it.
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
                      <article className="rounded-[22px] border border-[var(--border-light)] bg-[var(--bg-card)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_22px_rgba(61,79,95,0.04)]">
                        <div className="flex items-start gap-4">
                          <div className="relative mt-1 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-warm)]">
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

        <section className="bg-[var(--bg-card)] py-24">
          <div className="container mx-auto max-w-[var(--container)] px-6">
            <div className="grid gap-10 lg:grid-cols-[1.02fr_0.98fr]">
              <ScrollAnimation className="max-w-[620px]" animationType="slide-left">
                <div
                  className="mb-3 font-bold uppercase tracking-[0.22em] text-[var(--accent-warm)]"
                  style={{ fontSize: 'var(--text-caption)' }}
                >
                  SEO and trust
                </div>
                <h2
                  className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  The archive keeps working long after the email goes out.
                </h2>
                <p
                  className="leading-[1.75] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  This is the part many brands miss. A newsletter is not only an email. When each
                  issue lives on your site, it becomes a page that can rank in search, answer buyer
                  questions, and prove that you know your space.
                </p>
                <p
                  className="mt-5 leading-[1.75] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  That is why the archive matters. It helps people find you later, not just on send
                  day. AI Recap already shows this model in public: each issue adds to a growing
                  library people can read, share, and come back to.
                </p>
              </ScrollAnimation>

              <ScrollAnimation animationType="slide-right" delay={90}>
                <div className="rounded-[24px] border border-[var(--border-light)] bg-[var(--bg-main)] p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_30px_rgba(61,79,95,0.04)]">
                  <div
                    className="mb-5 font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]"
                    style={{ fontSize: 'var(--text-caption)' }}
                  >
                    What the archive gives you
                  </div>

                  <div className="grid gap-4">
                    {[
                      'More pages for Google to crawl and rank.',
                      'More proof for buyers who want to see how you think.',
                      'More ways for old issues to keep bringing in traffic.',
                    ].map((point) => (
                      <div
                        key={point}
                        className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-4"
                      >
                        <p
                          className="leading-[1.7] text-[var(--text-secondary)]"
                          style={{ fontSize: 'var(--text-body)' }}
                        >
                          {point}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-5">
                    <div
                      className="mb-2 font-bold uppercase tracking-[0.18em] text-[var(--accent-warm)]"
                      style={{ fontSize: 'var(--text-caption)' }}
                    >
                      Short version
                    </div>
                    <p
                      className="font-serif leading-[1.45] text-[var(--text-primary)]"
                      style={{ fontSize: 'calc(var(--text-card-title) * 1.05)' }}
                    >
                      Send once. Keep getting value from it later.
                    </p>
                  </div>
                </div>
              </ScrollAnimation>
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
                  How it starts
                </div>
                <h2
                  className="mb-5 font-serif font-normal leading-[1.14] tracking-[-0.015em] text-[var(--text-primary)]"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  Simple setup. Fast review. No weekly writing marathon.
                </h2>
                <p
                  className="leading-[1.75] text-[var(--text-secondary)]"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  We do the heavy lifting. You help us aim it well. That is the whole idea.
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
                  Get in touch
                </div>
                <h2
                  className="font-serif font-normal leading-[1.16] text-white"
                  style={{ fontSize: 'var(--text-section)' }}
                >
                  Tell us about the business, the topic, and what the newsletter should help you do.
                </h2>
                <p
                  className="mt-5 max-w-[540px] leading-[1.8] text-white/72"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  This gives us enough to see if the fit is right and how we would shape the
                  topic, the offer, the angle, and the format.
                </p>
                <p
                  className="mt-5 max-w-[540px] leading-[1.8] text-white/72"
                  style={{ fontSize: 'var(--text-body)' }}
                >
                  We build custom newsletters for your market. If you sell to finance, health,
                  real estate, SaaS, or something else, the newsletter is built around that world.
                </p>
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
