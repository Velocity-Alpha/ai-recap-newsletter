import ArticleAccessGate from "@/components/ArticleAccessGate";
import ArticlePreviewLock from "@/components/ArticlePreviewLock";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import SubscriptionSuccessToast from "@/components/SubscriptionSuccessToast";
import NewsletterIssueBody from "@/features/newsletter/ui/NewsletterIssueBody";
import { hasActiveSubscriberSession } from "@/features/subscriber/session";
import type { ParsedNewsletterIssue } from "@/features/newsletter/types";

function NewsletterNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <p className="text-lg text-[var(--text-secondary)]">Newsletter not found</p>
    </main>
  );
}

export default async function NewsletterIssuePage({
  issue,
}: {
  issue: ParsedNewsletterIssue | null;
}) {
  const hasSubscriberAccess = issue ? await hasActiveSubscriberSession() : false;
  const shouldShowGate = Boolean(issue && !hasSubscriberAccess);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header showSubscribeButton={!hasSubscriberAccess} />
      <SubscriptionSuccessToast />

      {issue ? (
        <main className="flex-1">
          {shouldShowGate ? (
            <ArticlePreviewLock gate={<ArticleAccessGate />}>
              <NewsletterIssueBody issue={issue} />
            </ArticlePreviewLock>
          ) : (
            <NewsletterIssueBody issue={issue} />
          )}
        </main>
      ) : (
        <NewsletterNotFound />
      )}

      <Footer showSubscribeLink={!hasSubscriberAccess} />
    </div>
  );
}
