import Header from "@/src/components/Header";
import Footer from "@/src/components/Footer";
import SubscribeNewsletter from "@/src/components/SubscribeNewsletter";
import { NewsletterIssueV1 } from "@/src/features/newsletter/render/NewsletterIssueV1";
import { NewsletterIssueV2 } from "@/src/features/newsletter/render/NewsletterIssueV2";
import type { ParsedNewsletterIssue } from "@/src/features/newsletter/types";

function NewsletterNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <p className="text-lg text-[var(--text-secondary)]">Newsletter not found</p>
    </main>
  );
}

export default function NewsletterContent({ issue }: { issue: ParsedNewsletterIssue | null }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />

      {issue ? (
        <main className="flex-1">
          {issue.schemaVersion === 2 ? (
            <NewsletterIssueV2 issue={issue} />
          ) : (
            <NewsletterIssueV1 issue={issue} />
          )}
          <SubscribeNewsletter />
        </main>
      ) : (
        <NewsletterNotFound />
      )}

      <Footer />
    </div>
  );
}
