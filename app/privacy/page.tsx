import Header from '@/src/components/Header'
import Footer from '@/src/components/Footer'
import React from 'react'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: "Privacy Policy | AI Recap",
  description: "Learn how AI Recap collects, uses, and protects your personal information.",
}

export default function PrivacyPage() {
  const lastUpdated = "February 2, 2026";

  return (
    <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
      <Header />
      <main className="flex-grow py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-[var(--text-primary)] mb-4">Privacy Policy</h1>
          <p className="text-[var(--text-muted)] mb-12">Last Updated: {lastUpdated}</p>

          <div className="space-y-10 text-[var(--text-secondary)] leading-relaxed">
            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">1. About This Policy</h2>
              <p>
                AI Recap ("we", "our", or "us"), operated by Velocity Alpha, respects your privacy and is committed to protecting it. This Privacy Policy describes how we collect, use, and share your information when you use our website and subscribe to our newsletter (collectively, the "Services").
              </p>
              <p className="mt-4">
                Although we are based in Canada, this policy is designed to comply with global privacy standards, including the GDPR (Europe), CCPA (California), and PIPEDA (Canada).
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">2. Information We Collect</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  <strong>Information You Provide:</strong> When you subscribe to our newsletter, we collect your email address. If you contact us directly, we may collect your name and any other information you provide.
                </li>
                <li>
                  <strong>Technical Data:</strong> As you navigate our site, we automatically collect technical information such as your IP address, browser type, device information, and how you interact with our pages (clicks, time spent). We use cookies and similar technologies for this.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">3. How We Use Your Information</h2>
              <p>We use your data to:</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li>Deliver our daily AI intelligence newsletter to your inbox.</li>
                <li>Improve our website performance and user experience.</li>
                <li>Analyze which content is most popular among our readers.</li>
                <li>Protect against fraud or unauthorized use of our Services.</li>
                <li>Comply with legal obligations.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">4. Sharing Your Information</h2>
              <p>
                We don't sell your personal data. We only share it with trusted service providers who help us run AI Recap, such as:
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong>Netlify:</strong> For website hosting and analytics.</li>
                <li><strong>Email Service Providers:</strong> To manage our mailing list and deliver newsletters.</li>
                <li><strong>Analytics Tools:</strong> To understand how visitors use our site.</li>
              </ul>
              <p className="mt-4">
                We may also disclose information if required by law or to protect our legal rights.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">5. Your Global Rights</h2>
              <p>Regardless of where you live, we want you to have control over your data:</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong>Access & Correction:</strong> You can ask for a copy of the data we have about you or ask us to fix inaccuracies.</li>
                <li><strong>Deletion:</strong> You can ask us to delete your information (subject to certain legal exceptions).</li>
                <li><strong>Opt-out:</strong> You can unsubscribe from our newsletter at any time by clicking the "unsubscribe" link at the bottom of any email.</li>
              </ul>
              <p className="mt-4">
                To exercise these rights, please contact us at <a href="mailto:borna@velocityalpha.com" className="text-[var(--accent-primary)] hover:underline">borna@velocityalpha.com</a>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">6. International Transfers</h2>
              <p>
                As a global service based in Canada, your information may be transferred to and processed in countries other than your own, including Canada and the United States. These countries may have different data protection laws than your jurisdiction. By using our Services, you consent to these transfers.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">7. Security</h2>
              <p>
                We implement industry-standard security measures to protect your data. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">8. Contact Us</h2>
              <p>
                If you have any questions about this policy, please reach out to us:
              </p>
              <div className="mt-4 p-6 bg-[var(--bg-secondary)] rounded-lg">
                <p className="font-bold text-[var(--text-primary)]">Velocity Alpha</p>
                <p>Attn: Privacy Officer</p>
                <p>Email: <a href="mailto:borna@velocityalpha.com" className="text-[var(--accent-primary)] hover:underline">borna@velocityalpha.com</a></p>
                <p>Location: Ontario, Canada</p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
