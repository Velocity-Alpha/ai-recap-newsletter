import { fetchNewsletterIssueById } from "@/features/newsletter/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { buildNewsletterIssueJsonLd, buildNewsletterIssueMetadata } from "@/features/newsletter/page";
import NewsletterIssuePage from "@/features/newsletter/ui/NewsletterIssuePage";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const issue = await fetchNewsletterIssueById(id);
  const canonicalPath = issue?.slug ? `/issue/${issue.slug}` : `/newsletter/${id}`;
  return buildNewsletterIssueMetadata(issue, canonicalPath);
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const issue = await fetchNewsletterIssueById(id);

  if (!issue) {
    return <NewsletterIssuePage issue={null} />;
  }

  if (issue.slug) {
    redirect(`/issue/${issue.slug}`);
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
