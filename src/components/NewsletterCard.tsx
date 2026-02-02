'use client'
import React from "react";
import { Newsletter } from "../types/newsletter.types";
import { useRouter } from "next/navigation";
import { formatDate } from "../utils/dateFormatter";
import { MessageSquare, ArrowRight } from "lucide-react";

interface Props {
  item: Newsletter;
}

const NewsletterCard: React.FC<Props> = ({ item }) => {
  const router = useRouter();
  return (
    <article
      className="group bg-[var(--bg-card)] border border-[var(--border-light)] rounded-lg overflow-hidden transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] cursor-pointer"
      onClick={() => router.push(`/newsletter/${item.id}`)}
    >
      {/* Image */}
      <div className="relative aspect-[16/10] bg-[var(--bg-warm)] overflow-hidden">
        {/* Watercolor placeholder effect */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse at 30% 40%, var(--watercolor-blue) 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, var(--watercolor-rust) 0%, transparent 50%)',
          opacity: 0.2
        }}></div>

        {item.feature_image_url && (
          <img
            src={item.feature_image_url}
            alt={item.title}
            className="w-full h-full object-cover"
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
        <div className="absolute top-4 left-4 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-card)] px-2.5 py-1 rounded">
          {formatDate(item.published_at)}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
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

