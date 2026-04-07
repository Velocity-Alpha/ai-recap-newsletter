import type { Metadata } from "next";

import type { ParsedNewsletterIssue } from "@/features/newsletter/types";

export function buildNewsletterIssueMetadata(
  issue: ParsedNewsletterIssue | null,
  canonicalPath: string,
): Metadata {
  if (!issue) {
    return {};
  }

  return {
    title: `${issue.title} | AI Recap`,
    description: issue.description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      type: "article",
      title: issue.title,
      description: issue.description,
      publishedTime: issue.issueDate ?? issue.publishedAt ?? undefined,
      ...(issue.imageUrl && {
        images: [{ url: issue.imageUrl, alt: issue.title }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: issue.title,
      description: issue.description,
      ...(issue.imageUrl && { images: [issue.imageUrl] }),
    },
  };
}

export function buildNewsletterIssueJsonLd(issue: ParsedNewsletterIssue) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: issue.title,
    description: issue.description,
    ...(issue.imageUrl && { image: issue.imageUrl }),
    datePublished: issue.issueDate ?? issue.publishedAt ?? undefined,
    publisher: {
      "@type": "Organization",
      name: "AI Recap",
      logo: {
        "@type": "ImageObject",
        url: "https://airecap.news/logo/OG-Logo.jpg",
      },
    },
  };
}
