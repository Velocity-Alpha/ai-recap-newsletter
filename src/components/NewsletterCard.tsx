'use client'
import React from "react";
import { Newsletter } from "../types/newsletter.types";
import { useRouter } from "next/navigation";
import { formatDate } from "../utils/dateFormatter";
import { MessageSquare, ArrowRight } from "lucide-react";
import Image from "next/image";

interface Props {
  item: Newsletter;
}

const NewsletterCard: React.FC<Props> = ({ item }) => {
  const router = useRouter();
  const hasFeatureImage = Boolean(item.feature_image_url);

  return (
    <article
      className="group bg-[var(--bg-card)] border border-[var(--border-light)] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_18px_rgba(61,79,95,0.04)] transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] cursor-pointer"
      onClick={() => router.push(`/newsletter/${item.id}`)}
    >
      {/* Image */}
      <div className={`relative aspect-[16/10] overflow-hidden ${hasFeatureImage ? "bg-white" : "bg-[var(--bg-warm)]"}`}>
        {/* Watercolor placeholder effect */}
        {!hasFeatureImage && (
          <div className="absolute inset-0" style={{
            background: 'radial-gradient(ellipse at 30% 40%, var(--watercolor-blue) 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, var(--watercolor-rust) 0%, transparent 50%)',
            opacity: 0.2
          }}></div>
        )}

        {hasFeatureImage && (
          <Image
            src={item.feature_image_url}
            alt={item.title}
            fill
            sizes="(max-width: 768px) calc(100vw - 3rem), (max-width: 1024px) calc(50vw - 2.25rem), 360px"
            className="object-contain"
          />
        )}

        {!item.feature_image_url && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 bg-[var(--bg-card)] rounded flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
              <MessageSquare size={24} className="stroke-[var(--text-secondary)]" />
            </div>
          </div>
        )}
        
        {/* Date badge */}
        <div className="absolute top-4 left-4 text-[11px] font-medium text-[var(--text-secondary)] bg-[rgba(247,246,243,0.94)] border border-[rgba(212,221,227,0.9)] shadow-[0_1px_2px_rgba(61,79,95,0.06)] px-2.5 py-1 rounded">
          {formatDate(item.issue_date ?? item.published_at)}
        </div>
      </div>

      {/* Content */}
      <div
        className="p-6"
        style={{
          background: "linear-gradient(180deg, rgba(250,250,248,0.96) 0%, rgba(255,255,255,1) 72%)",
        }}
      >
        <h3 className="font-serif font-normal leading-[1.35] text-[var(--text-primary)] mb-3" style={{ fontSize: 'var(--text-card-title)' }}>
          {item.title}
        </h3>
        
        <p className="leading-[1.6] text-[var(--text-secondary)] mb-4 line-clamp-2" style={{ fontSize: 'var(--text-body)' }}>
          {item.excerpt}
        </p>

        <div className="inline-flex items-center gap-1.5 font-medium text-[var(--accent-primary)] group-hover:gap-2.5 transition-all duration-200" style={{ fontSize: 'var(--text-small)' }}>
          <span>Read more</span>
          <ArrowRight size={14} />
        </div>
      </div>
    </article>
  );
};

export default NewsletterCard;
