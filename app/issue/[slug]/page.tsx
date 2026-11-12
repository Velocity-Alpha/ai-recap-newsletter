import type { Metadata } from "next";
import { fetchNewsletterIssueBySlug } from "@/src/features/newsletter/server";
import NewsletterContent from "./NewsletterContent";

// The CDN caches issue pages for up to an hour, cleared at once when an issue publishes (the published-issues
// tag on the issue read). Each page is built on its first visit, so the build reads no issues. A failed read
// throws, so a failed rebuild keeps the last good page.
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await fetchNewsletterIssueBySlug(slug);

  if (!issue) {
    return {};
  }

  return {
    title: `${issue.title} | AI Recap`,
    description: issue.description,
    alternates: {
      canonical: `/issue/${slug}`,
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

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const issue = await fetchNewsletterIssueBySlug(slug);

  if (!issue) {
    return <NewsletterContent issue={null} />;
  }

  const jsonLd = {
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <NewsletterContent issue={issue} />
    </>
  );
}
