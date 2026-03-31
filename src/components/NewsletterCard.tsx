'use client'
import React from "react";
import { Newsletter } from "../types/newsletter.types";
import { formatNewsletterDate } from "../utils/dateFormatter";
import { MessageSquare } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getTrimmedImageUrl } from "../lib/utils";

interface Props {
  item: Newsletter;
}

const NewsletterCard: React.FC<Props> = ({ item }) => {
  const featureImageUrl = getTrimmedImageUrl(item.feature_image_url);
  const hasFeatureImage = Boolean(featureImageUrl);

  return (
    <Link
      href={`/issue/${item.slug}`}
      aria-label={`Open newsletter: ${item.title}`}
      className="group block h-full cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2"
    >
      <article className="flex h-full flex-col overflow-hidden rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_18px_rgba(61,79,95,0.04)] transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)]">
        {/* Image */}
        <div className={`relative aspect-[16/10] overflow-hidden ${hasFeatureImage ? "bg-white" : "bg-[var(--bg-warm)]"}`}>
          {/* Watercolor placeholder effect */}
          {!hasFeatureImage && (
            <div className="absolute inset-0" style={{
              background: 'radial-gradient(ellipse at 30% 40%, var(--watercolor-blue) 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, var(--watercolor-rust) 0%, transparent 50%)',
              opacity: 0.2
            }}></div>
          )}

          {featureImageUrl && (
            <Image
              src={featureImageUrl}
              alt={item.title}
              fill
              sizes="(max-width: 768px) calc(100vw - 3rem), (max-width: 1024px) calc(50vw - 2.25rem), 360px"
              className="object-contain"
            />
          )}

          {!hasFeatureImage && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded bg-[var(--bg-card)] shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
                <MessageSquare size={24} className="stroke-[var(--text-secondary)]" />
              </div>
            </div>
          )}
          
          {/* Date badge */}
          <div className="absolute top-4 left-4 rounded border border-[rgba(212,221,227,0.9)] bg-[rgba(247,246,243,0.94)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(61,79,95,0.06)]">
            {formatNewsletterDate(item.issue_date ?? item.published_at)}
          </div>
        </div>

        {/* Content */}
        <div
          className="flex flex-1 flex-col p-6"
          style={{
            background: "linear-gradient(180deg, rgba(250,250,248,0.96) 0%, rgba(255,255,255,1) 72%)",
          }}
        >
          <h3 className="mb-3 font-serif font-normal leading-[1.35] text-[var(--text-primary)]" style={{ fontSize: 'var(--text-card-title)' }}>
            {item.title}
          </h3>
          
          <p className="line-clamp-2 leading-[1.6] text-[var(--text-secondary)]" style={{ fontSize: 'var(--text-body)' }}>
            {item.excerpt}
          </p>
        </div>
      </article>
    </Link>
  );
};

export default NewsletterCard;
