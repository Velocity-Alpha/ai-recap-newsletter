import type { Metadata } from "next";
import { buildNewsletterIssueJsonLd, buildNewsletterIssueMetadata } from "@/features/newsletter/page";
import { fetchNewsletterIssueBySlug } from "@/features/newsletter/server";
import NewsletterIssuePage from "@/features/newsletter/ui/NewsletterIssuePage";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await fetchNewsletterIssueBySlug(slug);

  return buildNewsletterIssueMetadata(issue, `/issue/${slug}`);
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const issue = await fetchNewsletterIssueBySlug(slug);

  if (!issue) {
    return <NewsletterIssuePage issue={null} />;
  }
  const jsonLd = buildNewsletterIssueJsonLd(issue);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <NewsletterIssuePage issue={issue} />
    </>
  );
}
