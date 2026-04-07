import Image from "next/image";
import {
  ArrowRight,
  FileText,
  Flame,
  FlaskConical,
  Sparkles,
  Wrench,
} from "lucide-react";

import { formatNewsletterDate } from "@/features/newsletter/formatters/date";
import type { ParsedNewsletterIssueV1, NewsletterStoryV1 } from "@/features/newsletter/types";

const LINK_ACCENT = "#b7410e";

function StoryLink({
  href,
  className,
  style,
  children,
}: {
  href: string | null;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style}>
      {children}
    </a>
  );
}

function SectionCard({
  icon,
  title,
  children,
  compact = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "mb-12 last:mb-0" : "mb-12 last:mb-0"}>
      <div className="mb-10 border-b-[1.5px] border-[var(--text-primary)] pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center text-[color:#7b858d] opacity-60">
            {icon}
          </span>
          <h2 className="font-sans text-[15px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {title}
          </h2>
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}

function OverviewCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12 rounded-lg border border-[color:#dfe5e8] bg-[color:#fffefd] px-6 py-5 shadow-[0_1px_2px_rgba(30,41,59,0.05)] sm:px-7 sm:py-6">
      <div>
        <div className="mb-7 border-b border-[color:#edf1f4] pb-2.5">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center text-[color:#7b858d] opacity-60">
              <FileText size={15} strokeWidth={1.8} />
            </span>
            <h2 className="font-sans text-[15px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              {title}
            </h2>
          </div>
        </div>
        <div className="max-w-[42rem]">{children}</div>
      </div>
    </section>
  );
}

function FeatureStory({ item, ctaLabel }: { item: NewsletterStoryV1; ctaLabel: string }) {
  return (
    <article className="mb-8 border-b border-[color:#edf1f4] pb-8 last:mb-0 last:border-b-0 last:pb-0">
      <h3 className="mb-2.5 font-serif text-[18px] font-semibold leading-snug text-[var(--text-primary)]">
        <StoryLink href={item.link} className="transition-colors hover:text-[color:#384b59] hover:underline">
          {item.title}
        </StoryLink>
      </h3>

      {item.summary && (
        <p className="mb-3.5 max-w-none text-[17px] leading-[1.7] text-[color:#4f616d] sm:text-[18px]">
          {item.summary}
        </p>
      )}

      {item.link && (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex w-fit items-center gap-1 border-b-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition hover:opacity-85"
          style={{ color: LINK_ACCENT, borderColor: LINK_ACCENT }}
        >
          {ctaLabel}
          <ArrowRight size={12} />
        </a>
      )}
    </article>
  );
}

function InlineLinkedItem({
  item,
}: {
  item: NewsletterStoryV1;
}) {
  return (
    <li className="border-b border-[color:#edf1f4] py-3 last:border-b-0 last:pb-0 first:pt-0">
      <div className="space-y-1.5">
        <StoryLink
          href={item.link}
          className="text-[15px] font-semibold leading-relaxed underline decoration-2 underline-offset-[3px] transition hover:opacity-85 sm:text-[16px]"
          style={{ color: LINK_ACCENT, textDecorationColor: LINK_ACCENT }}
        >
          {item.title}
        </StoryLink>
        {item.summary ? (
          <p className="text-[15px] leading-8 text-[color:#4f616d] sm:text-[16px]">{item.summary}</p>
        ) : null}
      </div>
    </li>
  );
}

export function NewsletterIssueV1({ issue }: { issue: ParsedNewsletterIssueV1 }) {
  const { title, displayDate, imageUrl, content } = issue;
  const { overview, topStories, research, tools, quickHits } = content;

  return (
    <div className="relative z-10 mx-auto max-w-[46rem] px-6 py-16">
      <div className="space-y-12 sm:space-y-16">
        <header className="space-y-4 text-center">
          <div className="space-y-2">
            <div
              className="inline-flex items-center gap-2 font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]"
              style={{ fontSize: "calc(var(--text-small) * 0.95)" }}
            >
              {displayDate ? formatNewsletterDate(displayDate) : "AI Recap Daily"}
            </div>
            <h1
              className="font-serif leading-[1.08] font-normal tracking-[-0.03em] text-[var(--text-primary)]"
              style={{ fontSize: "calc(var(--text-hero) * 0.84)" }}
            >
              {title}
            </h1>
          </div>
        </header>

        {imageUrl && (
          <div className="mx-auto max-w-[34rem]">
            <div className="relative aspect-[16/10] overflow-hidden bg-transparent">
              <Image
                src={imageUrl}
                sizes="(max-width: 768px) 100vw, 640px"
                alt={title}
                fill
                priority
                className="object-contain"
                style={{
                  maskImage: "radial-gradient(ellipse at center, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 100%)",
                  WebkitMaskImage: "radial-gradient(ellipse at center, rgba(0,0,0,1) 55%, rgba(0,0,0,0) 100%)",
                  maskSize: "100% 100%",
                  WebkitMaskSize: "100% 100%",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                }}
              />
            </div>
          </div>
        )}

        {overview && (
          <OverviewCard title="Today’s Overview">
            {overview.summary && (
              <p className="text-[17px] leading-[1.7] text-[color:#4f616d] sm:text-[18px]">{overview.summary}</p>
            )}

            {overview.highlights.length > 0 && (
              <ul className="mt-6 flex flex-col gap-1.5 pt-1">
                {overview.highlights.map((point, index) => (
                  <li key={`${point}-${index}`} className="flex items-start gap-3 text-[15px] leading-8 text-[color:#4f616d] sm:text-[16px]">
                    <span className="mt-[11px] h-[5px] w-[5px] flex-shrink-0 rounded-full bg-[color:#6a7a86]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}
          </OverviewCard>
        )}

        {topStories.length > 0 && (
          <SectionCard icon={<Flame size={15} strokeWidth={1.8} />} title="Top Stories">
            <div className="space-y-10">
              {topStories.map((story) => (
                <FeatureStory key={story.storyId ?? story.title} item={story} ctaLabel="Read Full Article" />
              ))}
            </div>
          </SectionCard>
        )}

        {research.length > 0 && (
          <SectionCard icon={<FlaskConical size={15} strokeWidth={1.8} />} title="Research & Analysis">
            <div className="space-y-10">
              {research.map((story) => (
                <FeatureStory key={story.storyId ?? story.title} item={story} ctaLabel="Read Source" />
              ))}
            </div>
          </SectionCard>
        )}

        {tools.length > 0 && (
          <SectionCard icon={<Wrench size={15} strokeWidth={1.8} />} title="Trending Tools" compact>
            <ul>
              {tools.map((tool) => (
                <InlineLinkedItem key={tool.storyId ?? tool.title} item={tool} />
              ))}
            </ul>
          </SectionCard>
        )}

        {quickHits.length > 0 && (
          <SectionCard icon={<Sparkles size={15} strokeWidth={1.8} />} title="Quick Hits" compact>
            <ul>
              {quickHits.map((hit) => (
                <InlineLinkedItem key={hit.storyId ?? hit.title} item={hit} />
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
