import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { unsubscribeSubscriberByToken } from "@/features/subscriber/service";

// Browser-facing unsubscribe page for signed links such as /unsubscribe?token=...
// Keep this separate from the GHL webhook path so humans never need to know webhook secrets.
type UnsubscribePageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

function getToken(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { token } = await searchParams;

  let message =
    "If this unsubscribe link was valid, you have been unsubscribed from AI Recap emails.";

  try {
    await unsubscribeSubscriberByToken({
      token: getToken(token),
    });
  } catch {
    message = "We couldn't process your unsubscribe request right now. Please try again later.";
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-main)]">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <section className="w-full max-w-2xl rounded-[28px] border border-[var(--border-light)] bg-white px-8 py-12 text-center shadow-[0_18px_40px_rgba(28,42,50,0.06)]">
          <h1 className="font-serif text-[2rem] leading-[1.1] text-[var(--text-primary)] sm:text-[2.5rem]">
            Email preferences updated
          </h1>
          <p className="mx-auto mt-4 max-w-[34rem] text-[17px] leading-[1.7] text-[var(--text-secondary)]">
            {message}
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
