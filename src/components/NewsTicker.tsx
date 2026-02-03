'use client'
import { useEffect, useState } from 'react';
import { getApiUrl } from '@/utils/apiConfig';

interface TickerStory {
  headline: string;
  day: string;
  category: string;
  createdAt: string;
}

const FALLBACK_STORIES: TickerStory[] = [
  { headline: "New breakthrough in transformer architecture promises 10x efficiency", category: "Product", day: new Date(Date.now() - 1000 * 60 * 15).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
  { headline: "Global summit on AI safety concludes with new framework agreement", category: "Policy", day: new Date(Date.now() - 1000 * 60 * 45).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
  { headline: "Major tech firms increase investment in green AI infrastructure", category: "Funding", day: new Date(Date.now() - 1000 * 60 * 120).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  { headline: "Researchers open-source new multi-modal model for medical imaging", category: "Product", day: new Date(Date.now() - 1000 * 60 * 300).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 300).toISOString() },
  { headline: "AI-powered educational tools show significant improvement in student outcomes", category: "Product", day: new Date(Date.now() - 1000 * 60 * 600).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 600).toISOString() },
  { headline: "Venture capital firms ramp up funding for early-stage AI startups", category: "Funding", day: new Date(Date.now() - 1000 * 60 * 1440).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 1440).toISOString() },
  { headline: "Legislators debate new copyright protections for AI-generated creative works", category: "Policy", day: new Date(Date.now() - 1000 * 60 * 2000).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 2000).toISOString() },
  { headline: "Industry leaders call for standardized benchmarks in AI performance", category: "Product", day: new Date(Date.now() - 1000 * 60 * 2800).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 2800).toISOString() },
  { headline: "Emerging markets see rapid adoption of mobile-first AI assistants", category: "Product", day: new Date(Date.now() - 1000 * 60 * 4000).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 4000).toISOString() },
  { headline: "New study explores long-term impact of AI on the global labor market", category: "Policy", day: new Date(Date.now() - 1000 * 60 * 5000).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 5000).toISOString() }
];

export default function NewsTicker() {
  const [stories, setStories] = useState<TickerStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [tickerStats, setTickerStats] = useState({
    stories: 48,
    tools: 12,
    papers: 8
  });

  useEffect(() => {
    // Fetch ticker news and stats
    const fetchNews = async () => {
      try {
        const response = await fetch(getApiUrl('fetch-ticker-news'));
        const result = await response.json();
        if (result.success) {
          if (result.data && result.data.length > 0) {
            setStories(result.data);
          } else {
            setStories(FALLBACK_STORIES);
          }
          
          if (result.stats) {
            setTickerStats(result.stats);
          }
        } else {
          setStories(FALLBACK_STORIES);
        }
      } catch (error) {
        console.error('Failed to fetch ticker news:', error);
        setStories(FALLBACK_STORIES);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, []);

  const getTimeAgo = (dateStr: string) => {
    const now = new Date();
    const storyDate = new Date(dateStr);
    const diffInMinutes = Math.floor((now.getTime() - storyDate.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 0) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  const mapCategoryToTagType = (category: string): 'funding' | 'product' | 'policy' => {
    const c = category?.toLowerCase() || '';
    if (c.includes('funding') || c.includes('investment') || c.includes('money') || c.includes('raised')) return 'funding';
    if (c.includes('policy') || c.includes('legal') || c.includes('regulation') || c.includes('law')) return 'policy';
    return 'product';
  };

  return (
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
          <span className="text-[11px] text-[var(--text-muted)] font-bold uppercase">AI Recap</span>
        </div>

        {/* Scrolling content */}
        <div className="relative h-[240px] overflow-hidden">
          <div 
            className="flex flex-col" 
            style={stories.length > 3 ? { 
              animation: `tickerLoop ${stories.length * 5}s linear infinite`,
            } : {}}
          >
            {loading ? (
              <div className="flex flex-col gap-4 px-5 py-4 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 bg-[var(--bg-warm)] rounded-md"></div>
                ))}
              </div>
            ) : stories.length > 0 ? (
              <>
                {/* Original items */}
                {stories.map((story, index) => (
                  <TickerItem 
                    key={`story-${index}`}
                    time={getTimeAgo(story.createdAt || story.day)} 
                    headline={story.headline} 
                    tag={story.category || 'Product'} 
                    tagType={mapCategoryToTagType(story.category)} 
                  />
                ))}
                {/* Duplicate items for seamless looping */}
                {stories.length > 3 && stories.map((story, index) => (
                  <TickerItem 
                    key={`story-loop-${index}`}
                    time={getTimeAgo(story.createdAt || story.day)} 
                    headline={story.headline} 
                    tag={story.category || 'Product'} 
                    tagType={mapCategoryToTagType(story.category)} 
                  />
                ))}
              </>
            ) : (
              <div className="px-5 py-8 text-center text-[var(--text-muted)] text-[13px]">
                No recent stories found
              </div>
            )}
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
          <span className="text-[12px] font-medium text-[var(--text-muted)] uppercase">
            This week
          </span>
        </div>
      </div>
    </div>
  );
}

function TickerItem({ time, headline, tag, tagType }: {
  time: string;
  headline: string;
  tag: string;
  tagType: 'funding' | 'product' | 'policy';
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
        </div>
      </div>
    </div>
  );
}
