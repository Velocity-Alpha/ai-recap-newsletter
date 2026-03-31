import { fetchNewsletterIssueById } from "@/src/features/newsletter/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NewsletterContent from "./NewsletterContent";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const issue = await fetchNewsletterIssueById(id);

  if (!issue) {
    return {};
  }

  const canonicalPath = issue.slug ? `/issue/${issue.slug}` : `/newsletter/${id}`;

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

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const issue = await fetchNewsletterIssueById(id);

  if (!issue) {
    return <NewsletterContent issue={null} />;
  }

  if (issue.slug) {
    redirect(`/issue/${issue.slug}`);
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
