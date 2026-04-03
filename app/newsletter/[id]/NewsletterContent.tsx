import Header from "@/src/components/Header";
import ArticlePreviewLock from "@/src/components/ArticlePreviewLock";
import Footer from "@/src/components/Footer";
import ArticleAccessGate from "@/src/components/ArticleAccessGate";
import SubscriptionSuccessToast from "@/src/components/SubscriptionSuccessToast";
import { NewsletterIssueV1 } from "@/src/features/newsletter/render/NewsletterIssueV1";
import { NewsletterIssueV2 } from "@/src/features/newsletter/render/NewsletterIssueV2";
import { findSubscriberById, getSubscriberSessionFromCookies } from "@/src/features/subscriber/server";
import type { ParsedNewsletterIssue } from "@/src/features/newsletter/types";

function NewsletterNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <p className="text-lg text-[var(--text-secondary)]">Newsletter not found</p>
    </main>
  );
}

export default async function NewsletterContent({ issue }: { issue: ParsedNewsletterIssue | null }) {
  const session = await getSubscriberSessionFromCookies();
  const subscriber =
    session && issue
      ? await findSubscriberById(session.subscriberId)
      : null;
  const hasSubscriberAccess =
    Boolean(subscriber) &&
    subscriber?.status === "active" &&
    subscriber.email === session?.email;
  const shouldShowGate = Boolean(issue && !hasSubscriberAccess);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <SubscriptionSuccessToast />

      {issue ? (
        <main className="flex-1">
          {shouldShowGate ? (
            <ArticlePreviewLock gate={<ArticleAccessGate />}>
              {issue.schemaVersion === 2 ? (
                <NewsletterIssueV2 issue={issue} />
              ) : (
                <NewsletterIssueV1 issue={issue} />
              )}
            </ArticlePreviewLock>
          ) : (
            <>
              {issue.schemaVersion === 2 ? (
                <NewsletterIssueV2 issue={issue} />
              ) : (
                <NewsletterIssueV1 issue={issue} />
              )}
            </>
          )}
        </main>
      ) : (
        <NewsletterNotFound />
      )}

      <Footer />
    </div>
  );
}
