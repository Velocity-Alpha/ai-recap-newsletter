import { fetchNewsletterIssueById } from "@/src/features/newsletter/server";
import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const issue = await fetchNewsletterIssueById(id);

  if (!issue?.slug) {
    return null;
  }

  redirect(`/issue/${issue.slug}`);
}
