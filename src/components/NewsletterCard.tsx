'use client'
import React from "react";
import { Newsletter } from "../types/newsletter.types";
import { useRouter } from "next/navigation";
import { formatDate } from "../utils/dateFormatter";

interface Props {
  item: Newsletter;
}

const NewsletterCard: React.FC<Props> = ({ item }) => {
  const router = useRouter();
  return (
    <div
      className="
        group bg-white text-card-foreground
        border border-border/50
        rounded-2xl overflow-hidden
        min-w-[320px] max-w-[400px]
        transition-all duration-500
        hover:border-primary/30
        hover:shadow-2xl
        hover:scale-[1.03]
        focus-within:ring-2 focus-within:ring-ring
        cursor-pointer
        relative
      "
      onClick={() => router.push(`/newsletter/${item.id}`)}
    >
      {/* Hover gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-primary/0 to-accent/0 group-hover:from-primary/5 group-hover:via-primary/3 group-hover:to-accent/5 transition-all duration-500 z-10 pointer-events-none"></div>

      {/* Image */}
      <div className="relative h-[220px] overflow-hidden">
        <img
          src={item.feature_image_url}
          alt={item.title}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent group-hover:from-black/80 transition-all duration-500"></div>
        
        {/* Date badge */}
        <div className="absolute top-4 left-4 px-3 py-1.5 bg-white/95 backdrop-blur-md rounded-full border border-white/50 shadow-lg">
          <p className="text-xs font-semibold text-foreground">{formatDate(item.published_at)}</p>
        </div>

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <h3 className="text-white font-bold text-lg leading-tight line-clamp-2 group-hover:text-white/90 transition-colors">
            {item.title}
          </h3>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 p-6 bg-white">
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed mb-4">
          {item.excerpt}
        </p>

        {/* Read more with enhanced styling */}
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary group-hover:gap-3 transition-all duration-300">
          <span>Read more</span>
          <span className="transform group-hover:translate-x-1 transition-transform duration-300">→</span>
        </div>
      </div>

      {/* Decorative corner element */}
      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
    </div>
  );
};

export default NewsletterCard;

