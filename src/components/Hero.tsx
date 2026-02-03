'use client'
import Link from 'next/link';
import { MessageSquare, Monitor, Globe } from 'lucide-react';
import NewsTicker from './NewsTicker';

export default function Hero() {
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
            <div className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--text-muted)] mb-6 opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
              <span className="w-1.5 h-1.5 bg-[var(--watercolor-sage)] rounded-full"></span>
              Daily AI Intelligence from AI Recap
            </div>

            <h1 className="font-serif font-normal leading-[1.12] tracking-[-0.02em] text-[var(--text-primary)] mb-6 opacity-0 animate-[fadeIn_0.5s_ease-out_0.05s_forwards]" style={{ fontSize: 'var(--text-hero)' }}>
              Stay Ahead with <em className="italic text-[var(--watercolor-ink)]">AI Recap</em>
            </h1>

            <p className="leading-[1.7] text-[var(--text-secondary)] mb-10 opacity-0 animate-[fadeIn_0.5s_ease-out_0.1s_forwards]" style={{ fontSize: 'var(--text-body)' }}>
              Get the latest AI news, breakthrough research, and practical insights delivered to your inbox every day. Join thousands of professionals staying ahead of the curve.
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
                href="/newsletters"
                className="px-6 py-3 bg-transparent text-[var(--text-primary)] text-[14px] font-semibold rounded border border-[var(--border)] transition-all duration-200 hover:border-[var(--text-primary)] hover:bg-[var(--bg-warm)] text-center"
              >
                Browse Newsletters
              </Link>
            </div>

            <div className="flex gap-16 pt-10 border-t border-[var(--border-light)] opacity-0 animate-[fadeIn_0.5s_ease-out_0.2s_forwards]">
              <div>
                <div className="font-serif text-[var(--text-primary)] leading-none mb-1" style={{ fontSize: 'var(--text-section)' }}>10K+</div>
                <div className="text-[var(--text-muted)]" style={{ fontSize: 'var(--text-caption)' }}>Subscribers</div>
              </div>
              <div>
                <div className="font-serif text-[var(--text-primary)] leading-none mb-1" style={{ fontSize: 'var(--text-section)' }}>Daily</div>
                <div className="text-[var(--text-muted)]" style={{ fontSize: 'var(--text-caption)' }}>Updates</div>
              </div>
              <div>
                <div className="font-serif text-[var(--text-primary)] leading-none mb-1" style={{ fontSize: 'var(--text-section)' }}>100%</div>
                <div className="text-[var(--text-muted)]" style={{ fontSize: 'var(--text-caption)' }}>Free</div>
              </div>
            </div>
          </div>

          {/* Right column - Ticker Showcase */}
          <NewsTicker />
        </div>
      </div>
    </section>
  );
}
