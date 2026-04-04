'use client'
import { useEffect, useState } from 'react';
import Link from 'next/link';
import NewsTicker from './NewsTicker';
import type { TickerStats, TickerStory } from '@/src/features/newsletter/repository';

const SUBSCRIBER_COUNT_START = 2309;
const SUBSCRIBER_COUNT_TARGET = 10000;
const SUBSCRIBER_COUNT_START_DATE = new Date(Date.UTC(2026, 2, 10));
const SUBSCRIBER_COUNT_CURVE_HOURS = 365 * 24;
const SUBSCRIBER_COUNT_ANIMATION_OFFSET = 80;
const SUBSCRIBER_COUNT_ANIMATION_MS = 900;
const MS_PER_HOUR = 60 * 60 * 1000;
const HERO_STAT_VALUE_SIZE = 'calc(var(--text-section) * 0.84)';
const HERO_STAT_LABEL_SIZE = 'calc(var(--text-caption) * 1.22)';

function getSubscriberCountForTime(now: Date) {
  const startUtc = SUBSCRIBER_COUNT_START_DATE.getTime();
  const elapsedHours = Math.max(0, (now.getTime() - startUtc) / MS_PER_HOUR);

  if (elapsedHours <= SUBSCRIBER_COUNT_CURVE_HOURS) {
    const progress = elapsedHours / SUBSCRIBER_COUNT_CURVE_HOURS;
    const curvedGrowth = progress * progress;

    return Math.round(
      SUBSCRIBER_COUNT_START +
        (SUBSCRIBER_COUNT_TARGET - SUBSCRIBER_COUNT_START) * curvedGrowth
    );
  }

  const extraHours = elapsedHours - SUBSCRIBER_COUNT_CURVE_HOURS;
  const averageHourlyGrowth =
    (SUBSCRIBER_COUNT_TARGET - SUBSCRIBER_COUNT_START) / SUBSCRIBER_COUNT_CURVE_HOURS;

  return Math.round(SUBSCRIBER_COUNT_TARGET + extraHours * averageHourlyGrowth);
}

interface HeroProps {
  initialTickerStories: TickerStory[];
  initialTickerStats: TickerStats | null;
}

export default function Hero({ initialTickerStories, initialTickerStats }: HeroProps) {
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [statsReady, setStatsReady] = useState(false);

  useEffect(() => {
    const finalCount = getSubscriberCountForTime(new Date());
    const startingCount = Math.max(0, finalCount - SUBSCRIBER_COUNT_ANIMATION_OFFSET);

    let frameId = 0;
    let animationStart = 0;
    let hasRevealedStats = false;

    const animateCount = (now: number) => {
      if (!animationStart) {
        animationStart = now;
      }

      const progress = Math.min((now - animationStart) / SUBSCRIBER_COUNT_ANIMATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextCount = Math.round(
        startingCount + (finalCount - startingCount) * easedProgress
      );

      if (!hasRevealedStats) {
        hasRevealedStats = true;
        setStatsReady(true);
      }

      setSubscriberCount(nextCount);

      if (progress < 1) {
        frameId = requestAnimationFrame(animateCount);
      }
    };

    frameId = requestAnimationFrame(animateCount);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return (
    <section className="relative py-24 lg:py-32 bg-[var(--bg-card)] overflow-hidden">
      {/* Watercolor background blobs */}
      <div className="watercolor-blob -top-20 -right-16 w-[450px] h-[450px] bg-[var(--watercolor-blue)]"
           style={{ filter: 'blur(80px)', animation: 'blobFloat1 10s ease-in-out infinite' }}></div>
      <div className="watercolor-blob top-[20%] -left-[5%] w-[380px] h-[380px] bg-[var(--watercolor-rust)]"
           style={{ filter: 'blur(100px)', animation: 'blobFloat2 12s ease-in-out infinite' }}></div>
      <div className="watercolor-blob top-[15%] right-[25%] w-[320px] h-[320px] bg-[var(--watercolor-sage)]"
           style={{ filter: 'blur(60px)', animation: 'blobFloat3 8s ease-in-out infinite' }}></div>

      <div className="container mx-auto px-6 max-w-[var(--container)] relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left column - Content */}
          <div className="max-w-[500px] mx-auto lg:mx-0">
            <div className="uppercase tracking-[0.22em] font-bold text-[var(--accent-warm)] mb-6 opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]" style={{ fontSize: 'var(--text-caption)' }}>
              Daily AI Intelligence
            </div>

            <h1 className="font-serif font-normal leading-[1.12] tracking-[-0.02em] text-[var(--text-primary)] mb-6 opacity-0 animate-[fadeIn_0.5s_ease-out_0.05s_forwards]" style={{ fontSize: 'var(--text-hero)' }}>
              Stay Ahead of <span className="text-[var(--accent-warm)]">AI</span>
            </h1>

            <p className="leading-[1.7] text-[var(--text-secondary)] mb-10 opacity-0 animate-[fadeIn_0.5s_ease-out_0.1s_forwards]" style={{ fontSize: 'calc(var(--text-body) * 1.08)' }}>
              Get the latest AI news, breakthrough research, and practical insights delivered to your inbox every day by AI Recap. Join thousands of professionals staying ahead of the curve.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-16 opacity-0 animate-[fadeIn_0.5s_ease-out_0.15s_forwards]">
              <button
                onClick={() => {
                  document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-6 py-3 bg-[var(--text-primary)] text-white text-[14px] font-semibold rounded transition-all duration-200 hover:bg-[var(--watercolor-ink)]"
              >
                Subscribe Free
              </button>
              <Link
                href="/archive"
                className="px-6 py-3 bg-transparent text-[var(--text-primary)] text-[14px] font-semibold rounded border border-[var(--border)] transition-all duration-200 hover:border-[var(--text-primary)] hover:bg-[var(--bg-warm)] text-center"
              >
                Browse Archive
            </Link>
            </div>

            {statsReady && subscriberCount !== null ? (
              <div className="flex gap-16 pt-10 border-t border-[var(--border-light)] opacity-0 animate-[fadeIn_0.5s_ease-out_0.2s_forwards]">
                <div>
                  <div className="font-serif text-[var(--text-primary)] leading-none mb-1" style={{ fontSize: HERO_STAT_VALUE_SIZE }}>
                    {subscriberCount.toLocaleString('en-US')}
                  </div>
                  <div className="text-[var(--text-muted)]" style={{ fontSize: HERO_STAT_LABEL_SIZE }}>Subscribers</div>
                </div>
                <div>
                  <div className="font-serif text-[var(--text-primary)] leading-none mb-1" style={{ fontSize: HERO_STAT_VALUE_SIZE }}>Daily</div>
                  <div className="text-[var(--text-muted)]" style={{ fontSize: HERO_STAT_LABEL_SIZE }}>AI News Tracked</div>
                </div>
                <div>
                  <div className="font-serif text-[var(--text-primary)] leading-none mb-1" style={{ fontSize: HERO_STAT_VALUE_SIZE }}>100%</div>
                  <div className="text-[var(--text-muted)]" style={{ fontSize: HERO_STAT_LABEL_SIZE }}>Free</div>
                </div>
              </div>
            ) : (
              <div className="h-[76px]" aria-hidden="true" />
            )}
          </div>

          {/* Right column - Ticker Showcase */}
          <NewsTicker
            initialStories={initialTickerStories}
            initialTickerStats={initialTickerStats}
          />
        </div>
      </div>
    </section>
  );
}
