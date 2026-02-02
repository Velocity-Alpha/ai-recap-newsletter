'use client'
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessageSquare, Monitor, Globe } from 'lucide-react';

export default function Hero() {
  const [tickerStats, setTickerStats] = useState({
    stories: 52,
    tools: 14,
    papers: 9
  });

  useEffect(() => {
    // Randomize stats on mount
    setTickerStats({
      stories: Math.floor(Math.random() * 20) + 40,
      tools: Math.floor(Math.random() * 8) + 10,
      papers: Math.floor(Math.random() * 6) + 6
    });
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
          <div className="flex justify-center items-center relative max-w-[400px] mx-auto">
            {/* Decorative watercolor blurs behind ticker */}
            <div className="absolute -top-8 -right-10 w-[150px] h-[150px] bg-[var(--watercolor-rust)] opacity-[0.12] rounded-full" style={{ filter: 'blur(50px)', zIndex: -1 }}></div>
            <div className="absolute -bottom-5 -left-8 w-[120px] h-[120px] bg-[var(--watercolor-blue)] opacity-[0.15] rounded-full" style={{ filter: 'blur(40px)', zIndex: -1 }}></div>

            {/* Ticker */}
            <div className="bg-[var(--bg-card)] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.06),0_20px_48px_rgba(0,0,0,0.08)] relative w-full">
              {/* Watercolor accent bar */}
              <div className="absolute top-0 left-0 right-0 h-[3px] opacity-80"
                   style={{ background: 'linear-gradient(90deg, var(--watercolor-blue) 0%, var(--watercolor-sage) 50%, var(--watercolor-rust) 100%)' }}></div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 bg-[var(--bg-warm)] border-b border-[var(--border-light)]">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-warm)]">
                  <span className="w-[7px] h-[7px] bg-[var(--accent-warm)] rounded-full animate-[livePulse_2s_ease-in-out_infinite]"></span>
                  Live Feed
                </div>
                <span className="text-[11px] text-[var(--text-muted)] font-medium">AI Recap</span>
              </div>

              {/* Scrolling content */}
              <div className="relative h-[240px] overflow-hidden">
                <div className="flex flex-col" style={{ animation: 'tickerScroll 16s ease-in-out infinite' }}>
                  {/* Ticker items */}
                  <TickerItem time="3m ago" headline="Anthropic closes $3B round at $60B valuation" tag="Funding" tagType="funding" source="Reuters" />
                  <TickerItem time="21m ago" headline="Meta releases Llama 4 with 128K context window" tag="Product" tagType="product" source="The Verge" />
                  <TickerItem time="1h ago" headline="EU AI Act enforcement begins for high-risk systems" tag="Policy" tagType="policy" source="TechCrunch" />
                  <TickerItem time="2h ago" headline="Google DeepMind unveils Gemini 2.0 Flash" tag="Product" tagType="product" source="Wired" />
                  {/* Loop item */}
                  <TickerItem time="3m ago" headline="Anthropic closes $3B round at $60B valuation" tag="Funding" tagType="funding" source="Reuters" />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3.5 bg-[var(--bg-warm)] border-t border-[var(--border-light)]">
                <div className="flex gap-5">
                  <div className="text-center">
                    <div className="font-serif text-[16px] text-[var(--text-primary)] leading-none">{tickerStats.stories}</div>
                    <div className="text-[9px] uppercase tracking-[0.05em] text-[var(--text-muted)] mt-0.5">Stories</div>
                  </div>
                  <div className="text-center">
                    <div className="font-serif text-[16px] text-[var(--text-primary)] leading-none">{tickerStats.tools}</div>
                    <div className="text-[9px] uppercase tracking-[0.05em] text-[var(--text-muted)] mt-0.5">Tools</div>
                  </div>
                  <div className="text-center">
                    <div className="font-serif text-[16px] text-[var(--text-primary)] leading-none">{tickerStats.papers}</div>
                    <div className="text-[9px] uppercase tracking-[0.05em] text-[var(--text-muted)] mt-0.5">Papers</div>
                  </div>
                </div>
                <Link href="/newsletters" className="text-[12px] font-medium text-[var(--accent-primary)] hover:underline">
                  Full briefing →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TickerItem({ time, headline, tag, tagType, source }: {
  time: string;
  headline: string;
  tag: string;
  tagType: 'funding' | 'product' | 'policy';
  source: string;
}) {
  const tagColors = {
    funding: 'text-[var(--watercolor-rust-deep)] bg-[rgba(196,164,132,0.15)]',
    product: 'text-[var(--watercolor-blue-deep)] bg-[rgba(168,197,217,0.25)]',
    policy: 'text-[#6B8E6B] bg-[rgba(157,180,160,0.2)]'
  };

  return (
    <div className="flex gap-4 px-5 py-4 min-h-[80px] border-b border-[var(--border-light)] hover:bg-[var(--bg-warm)] transition-colors duration-200">
      <span className="text-[11px] font-medium text-[var(--text-muted)] whitespace-nowrap min-w-[48px] pt-0.5">{time}</span>
      <div className="flex-1">
        <div className="font-serif text-[15px] text-[var(--text-primary)] leading-[1.4] mb-1.5">{headline}</div>
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-[0.03em] ${tagColors[tagType]}`}>{tag}</span>
          <span>{source}</span>
        </div>
      </div>
    </div>
  );
}
