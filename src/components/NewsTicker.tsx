'use client'
import { useEffect, useRef, useState } from 'react';
import { getApiUrl } from '@/utils/apiConfig';

interface TickerStory {
  headline: string;
  day?: string;
  category?: string;
  createdAt?: string;
  relativeTimeLabel?: string;
}

const FALLBACK_STORIES: TickerStory[] = [
  { headline: "New breakthrough in transformer architecture promises 10x efficiency", category: "Product", relativeTimeLabel: "15m ago" },
  { headline: "Global summit on AI safety concludes with new framework agreement", category: "Policy", relativeTimeLabel: "45m ago" },
  { headline: "Major tech firms increase investment in green AI infrastructure", category: "Funding", relativeTimeLabel: "2h ago" },
  { headline: "Researchers open-source new multi-modal model for medical imaging", category: "Product", relativeTimeLabel: "5h ago" },
  { headline: "AI-powered educational tools show significant improvement in student outcomes", category: "Product", relativeTimeLabel: "10h ago" },
  { headline: "Venture capital firms ramp up funding for early-stage AI startups", category: "Funding", relativeTimeLabel: "1d ago" },
  { headline: "Legislators debate new copyright protections for AI-generated creative works", category: "Policy", relativeTimeLabel: "1d ago" },
  { headline: "Industry leaders call for standardized benchmarks in AI performance", category: "Product", relativeTimeLabel: "2d ago" },
  { headline: "Emerging markets see rapid adoption of mobile-first AI assistants", category: "Product", relativeTimeLabel: "2d ago" },
  { headline: "New study explores long-term impact of AI on the global labor market", category: "Policy", relativeTimeLabel: "3d ago" }
];

const ITEM_HEIGHT_PX = 80;
const VIEWPORT_HEIGHT_PX = 240;
const SECONDS_PER_ITEM = 5;

export default function NewsTicker() {
  const [stories, setStories] = useState<TickerStory[]>(FALLBACK_STORIES);
  const [animationOffsetSeconds, setAnimationOffsetSeconds] = useState(0);
  const [tickerStats, setTickerStats] = useState<{
    stories: number;
    tools: number;
    papers: number;
  } | null>(null);
  const mountTimeRef = useRef<number | null>(null);
  const handoffTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => {
    mountTimeRef.current = performance.now();

    const clearHandoffTimeout = () => {
      if (handoffTimeoutRef.current) {
        window.clearTimeout(handoffTimeoutRef.current);
        handoffTimeoutRef.current = null;
      }
    };

    const getElapsedSeconds = () => {
      if (!mountTimeRef.current) return 0;
      return Math.max((performance.now() - mountTimeRef.current) / 1000, 0);
    };

    const getCurrentOffset = (storyCount: number) => {
      if (storyCount <= 0) return 0;

      const elapsedSeconds = getElapsedSeconds();
      const pixelsPerSecond = ITEM_HEIGHT_PX / SECONDS_PER_ITEM;
      const totalHeight = storyCount * ITEM_HEIGHT_PX;

      return (elapsedSeconds * pixelsPerSecond) % totalHeight;
    };

    const getNextHiddenIndex = (storyCount: number, currentOffset: number) => {
      const lastVisibleIndex = Math.floor((currentOffset + VIEWPORT_HEIGHT_PX - 1) / ITEM_HEIGHT_PX);
      return (lastVisibleIndex + 1) % storyCount;
    };

    const getMsUntilItemExitsViewport = (
      storyCount: number,
      itemIndex: number,
      currentOffset: number
    ) => {
      const pixelsPerSecond = ITEM_HEIGHT_PX / SECONDS_PER_ITEM;
      const totalHeight = storyCount * ITEM_HEIGHT_PX;
      let distanceToExit = ((itemIndex + 1) * ITEM_HEIGHT_PX) - currentOffset;

      while (distanceToExit <= 0) {
        distanceToExit += totalHeight;
      }

      return Math.ceil((distanceToExit / pixelsPerSecond) * 1000);
    };

    // Fetch ticker news and stats
    const fetchNews = async () => {
      try {
        const response = await fetch(getApiUrl('fetch-ticker-news'));

        if (!response.ok) {
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return;
        }

        const result = await response.json();
        if (result.success) {
          if (result.data && result.data.length > 0) {
            const liveStories = result.data as TickerStory[];
            const currentOffset = getCurrentOffset(FALLBACK_STORIES.length);
            const nextHiddenIndex = getNextHiddenIndex(FALLBACK_STORIES.length, currentOffset);
            const stagedStories = FALLBACK_STORIES.map((story, index) =>
              index === nextHiddenIndex ? liveStories[0] : story
            );

            clearHandoffTimeout();
            setAnimationOffsetSeconds(getElapsedSeconds());
            setStories(stagedStories);

            handoffTimeoutRef.current = window.setTimeout(() => {
              setAnimationOffsetSeconds(getElapsedSeconds());
              setStories(liveStories);
              handoffTimeoutRef.current = null;
            }, getMsUntilItemExitsViewport(FALLBACK_STORIES.length, nextHiddenIndex, currentOffset) + 150);
          }

          if (result.stats) {
            setTickerStats(result.stats);
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          const message = error instanceof Error ? error.message : 'Unknown fetch error';
          console.warn(`Ticker feed unavailable, using fallback stories: ${message}`);
        }
      }
    };

    fetchNews();

    return clearHandoffTimeout;
  }, []);

  const getTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Just now';

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

  const getStoryTimeLabel = (story: TickerStory) => {
    if (story.relativeTimeLabel) return story.relativeTimeLabel;
    return getTimeAgo(story.createdAt || story.day);
  };

  const mapCategoryToTagType = (category: string): 'funding' | 'product' | 'policy' => {
    const c = category?.toLowerCase() || '';
    if (c.includes('funding') || c.includes('investment') || c.includes('money') || c.includes('raised')) return 'funding';
    if (c.includes('policy') || c.includes('legal') || c.includes('regulation') || c.includes('law')) return 'policy';
    return 'product';
  };

  const getTickerAnimationStyle = () => {
    if (stories.length <= 3) {
      return {};
    }

    return {
      animation: `tickerLoop ${stories.length * SECONDS_PER_ITEM}s linear infinite`,
      animationDelay: `-${animationOffsetSeconds}s`,
    };
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
            style={getTickerAnimationStyle()}
          >
            {stories.length > 0 ? (
              <>
                {/* Original items */}
                {stories.map((story, index) => (
                  <TickerItem 
                    key={`story-${index}`}
                    time={getStoryTimeLabel(story)}
                    headline={story.headline} 
                    tag={story.category || 'Product'} 
                    tagType={mapCategoryToTagType(story.category)} 
                  />
                ))}
                {/* Duplicate items for seamless looping */}
                {stories.length > 3 && stories.map((story, index) => (
                  <TickerItem 
                    key={`story-loop-${index}`}
                    time={getStoryTimeLabel(story)}
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
        <div className="h-[60px] bg-[var(--bg-warm)] border-t border-[var(--border-light)]">
          <div
            className={`flex h-full items-center justify-between px-5 transition-opacity duration-500 ease-out ${
              tickerStats ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden={!tickerStats}
          >
            <div className="flex gap-5">
              <div className="text-center">
                <div className="font-serif text-[16px] text-[var(--text-primary)] leading-none">{tickerStats?.stories ?? ''}</div>
                <div className="text-[9px] uppercase tracking-[0.05em] text-[var(--text-muted)] mt-0.5">Stories</div>
              </div>
              <div className="text-center">
                <div className="font-serif text-[16px] text-[var(--text-primary)] leading-none">{tickerStats?.tools ?? ''}</div>
                <div className="text-[9px] uppercase tracking-[0.05em] text-[var(--text-muted)] mt-0.5">Tools</div>
              </div>
              <div className="text-center">
                <div className="font-serif text-[16px] text-[var(--text-primary)] leading-none">{tickerStats?.papers ?? ''}</div>
                <div className="text-[9px] uppercase tracking-[0.05em] text-[var(--text-muted)] mt-0.5">Papers</div>
              </div>
            </div>
            <span className="text-[12px] font-medium text-[var(--text-muted)] uppercase">
              This week
            </span>
          </div>
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
