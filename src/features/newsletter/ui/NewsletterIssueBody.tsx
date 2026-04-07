import { NewsletterIssueV1 } from "@/features/newsletter/render/NewsletterIssueV1";
import { NewsletterIssueV2 } from "@/features/newsletter/render/NewsletterIssueV2";
import type { ParsedNewsletterIssue } from "@/features/newsletter/types";

export default function NewsletterIssueBody({ issue }: { issue: ParsedNewsletterIssue }) {
  return issue.schemaVersion === 2
    ? <NewsletterIssueV2 issue={issue} />
    : <NewsletterIssueV1 issue={issue} />;
}
