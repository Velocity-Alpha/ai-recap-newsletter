import Image from "next/image";
import {
  FileText,
  Flame,
  FlaskConical,
  Sparkles,
  Wrench,
} from "lucide-react";

import { formatNewsletterDate, formatNewsletterDateWithWeekday } from "@/src/utils/dateFormatter";
import type {
  HighlightBullet,
  NewsletterCompactListItemV2,
  NewsletterFeatureItemV2,
  NewsletterLinkListItemV2,
  ParsedNewsletterIssueV2,
} from "@/src/features/newsletter/types";

const LINK_ACCENT = "#b7410e";

function ExternalTextLink({
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
    return <span className={className} style={style}>{children}</span>;
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

function OverviewSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12 rounded-lg border border-[color:#dfe5e8] bg-[color:#fffefd] px-6 py-5 shadow-[0_1px_2px_rgba(30,41,59,0.05)] sm:px-7 sm:py-6">
      <div>
        <div className="mb-7 border-b border-[color:#edf1f4] pb-2.5">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center text-[color:#7b858d] opacity-60">
              {icon}
            </span>
            <h2 className="font-sans text-[15px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              {title}
            </h2>
          </div>
        </div>
        <div className="max-w-[42rem]">
          {children}
        </div>
      </div>
    </section>
  );
}

function needsSpacer(previous: string, next: string) {
  if (!previous || !next) {
    return false;
  }

  const previousEndsWithWhitespace = /\s$/.test(previous);
  const nextStartsWithWhitespace = /^\s/.test(next);
  const nextStartsWithPunctuation = /^[,.;:!?)]/.test(next);

  return !previousEndsWithWhitespace && !nextStartsWithWhitespace && !nextStartsWithPunctuation;
}

function HighlightedBullet({ bullet }: { bullet: HighlightBullet }) {
  return (
    <li className="flex items-start gap-3 text-[17px] leading-[1.7] text-[color:#4f616d] sm:text-[18px]">
      <span className="mt-[13px] h-[5px] w-[5px] flex-shrink-0 rounded-full bg-[color:#6a7a86]" />
      <span>
        {bullet.before}
        {needsSpacer(bullet.before, bullet.highlight) ? " " : null}
        <strong className="font-semibold text-[var(--text-primary)]">{bullet.highlight}</strong>
        {needsSpacer(bullet.highlight, bullet.after) ? " " : null}
        {bullet.after}
      </span>
    </li>
  );
}

function FeatureStory({ item }: { item: NewsletterFeatureItemV2 }) {
  return (
    <article className="mb-8 border-b border-[color:#edf1f4] pb-8 last:mb-0 last:border-b-0 last:pb-0">
      <h3 className="mb-2.5 font-serif text-[18px] font-semibold leading-snug text-[var(--text-primary)]">
        <ExternalTextLink
          href={item.url}
          className="transition-colors hover:text-[color:#384b59] hover:underline"
        >
          {item.headline}
        </ExternalTextLink>
      </h3>

      {item.storyDetail && (
        <p className="mb-3.5 max-w-none text-[17px] leading-[1.7] text-[color:#4f616d] sm:text-[18px]">
          {item.storyDetail}
        </p>
      )}

      {item.bullets && item.bullets.length > 0 && (
        <ul className="flex flex-col gap-1.5 pt-1">
          {item.bullets.map((bullet, index) => (
            <HighlightedBullet key={`${item.storyId ?? item.headline}-${index}`} bullet={bullet} />
          ))}
        </ul>
      )}

      {item.url && (
        <div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block w-fit border-b-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition hover:opacity-85"
            style={{ color: LINK_ACCENT, borderColor: LINK_ACCENT }}
          >
            Read more →
          </a>
        </div>
      )}
    </article>
  );
}

function InlineLinkedItem({
  href,
  label,
  text,
}: {
  href: string | null;
  label: string;
  text: string;
}) {
  return (
    <li className="border-b border-[color:#edf1f4] py-3 last:border-b-0 last:pb-0 first:pt-0">
      <p className="text-[15px] leading-8 text-[color:#4f616d] sm:text-[16px]">
        <ExternalTextLink
          href={href}
          className="border-b-2 pb-[1px] font-semibold transition hover:opacity-85"
          style={{ color: LINK_ACCENT, borderColor: LINK_ACCENT }}
        >
          {label}
        </ExternalTextLink>
        {text ? <span className="text-[color:#495c67]"> {text}</span> : null}
      </p>
    </li>
  );
}

function LinkList({ items, getText }: { items: Array<NewsletterLinkListItemV2 | NewsletterCompactListItemV2>; getText: (item: NewsletterLinkListItemV2 | NewsletterCompactListItemV2) => string }) {
  return (
    <ul>
      {items.map((item) => (
        <InlineLinkedItem
          key={item.storyId ?? item.linkText}
          href={item.url}
          label={item.linkText}
          text={getText(item)}
        />
      ))}
    </ul>
  );
}

export function NewsletterIssueV2({ issue }: { issue: ParsedNewsletterIssueV2 }) {
  const { title, displayDate, imageUrl, content } = issue;
  const subtitleDate = displayDate ? formatNewsletterDateWithWeekday(displayDate) : null;
  const shortDate = displayDate ? formatNewsletterDate(displayDate) : null;

  return (
    <div className="relative z-10 px-6 py-14 sm:py-18">
      <div className="mx-auto max-w-[46rem] space-y-12 sm:space-y-16">
        <header className="space-y-4 text-center">
          <div className="space-y-2">
            {subtitleDate && (
              <div
                className="inline-flex items-center gap-2 font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]"
                style={{ fontSize: "calc(var(--text-small) * 0.95)" }}
              >
                {subtitleDate}
              </div>
            )}
            {!subtitleDate && shortDate && (
              <div
                className="inline-flex items-center gap-2 font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]"
                style={{ fontSize: "calc(var(--text-small) * 0.95)" }}
              >
                {shortDate}
              </div>
            )}
            <h1 className="font-serif text-[2.45rem] font-normal leading-[1.06] tracking-[-0.03em] text-[var(--text-primary)] sm:text-[3.45rem]">
              {title}
            </h1>
          </div>
        </header>

        {imageUrl && (
          <div className="mx-auto max-w-[34rem]">
            <div className="relative aspect-[16/10] overflow-hidden bg-transparent">
              <Image src={imageUrl} alt={title} fill priority className="object-contain" sizes="(max-width: 768px) 100vw, 640px" />
            </div>
          </div>
        )}

        {content.overview && (
          <OverviewSection icon={<FileText size={15} strokeWidth={2.5} />} title="Today’s Overview">
            <p className="text-[17px] leading-[1.7] text-[color:#4f616d] sm:text-[18px]">{content.overview.summary}</p>
          </OverviewSection>
        )}

        {content.headlines.length > 0 && (
          <SectionCard icon={<Flame size={15} strokeWidth={2.5} />} title="Top Stories">
            <div className="space-y-10">
              {content.headlines.map((item) => (
                <FeatureStory key={item.storyId ?? item.headline} item={item} />
              ))}
            </div>
          </SectionCard>
        )}

        {content.researchAndAnalysis.length > 0 && (
          <SectionCard icon={<FlaskConical size={15} strokeWidth={2.5} />} title="Research & Analysis">
            <div className="space-y-10">
              {content.researchAndAnalysis.map((item) => (
                <FeatureStory key={item.storyId ?? item.headline} item={item} />
              ))}
            </div>
          </SectionCard>
        )}

        {content.tools.length > 0 && (
          <SectionCard icon={<Wrench size={15} strokeWidth={2.5} />} title="Trending AI Tools" compact>
            <LinkList items={content.tools} getText={(item) => ("detail" in item ? item.detail : "")} />
          </SectionCard>
        )}

        {content.quickHits.length > 0 && (
          <SectionCard icon={<Sparkles size={15} strokeWidth={2.5} />} title="Quick Hits" compact>
            <LinkList items={content.quickHits} getText={(item) => ("text" in item ? item.text : "")} />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
