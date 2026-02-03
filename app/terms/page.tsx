import Header from '@/src/components/Header'
import Footer from '@/src/components/Footer'
import React from 'react'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: "Terms of Service | AI Recap",
  description: "Read the rules and conditions for using the AI Recap website and newsletter.",
}

export default function TermsPage() {
  const lastUpdated = "February 2, 2026";

  return (
    <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
      <Header />
      <main className="flex-grow py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-[var(--text-primary)] mb-4">Terms of Service</h1>
          <p className="text-[var(--text-muted)] mb-12">Last Updated: {lastUpdated}</p>

          <div className="space-y-10 text-[var(--text-secondary)] leading-relaxed">
            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">1. Acceptance of Terms</h2>
              <p>
                By accessing AI Recap (the "Service"), operated by Velocity Alpha ("we", "us", or "our"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">2. Description of Service</h2>
              <p>
                AI Recap provides artificial intelligence news, research summaries, and implementation guides via our website and daily email newsletter. The Service is provided for informational purposes only.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">3. Intellectual Property</h2>
              <p>
                All content on the Service, including text, logos, designs, and code, is the property of Velocity Alpha or our content suppliers and is protected by copyright and intellectual property laws. 
              </p>
              <p className="mt-4">
                You may use our content for personal, non-commercial purposes only. You may not republish, sell, or redistribute our content without prior written consent.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">4. User Conduct</h2>
              <p>
                You agree not to use the Service for any unlawful purpose or in any way that could damage, disable, or impair the Service. You may not attempt to gain unauthorized access to our systems or user data.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">5. Disclaimer of Warranties</h2>
              <p className="italic">
                The Service is provided on an "AS IS" and "AS AVAILABLE" basis.
              </p>
              <p className="mt-4">
                Velocity Alpha makes no warranties, expressed or implied, regarding the accuracy, completeness, or reliability of the content provided. We do not guarantee that the Service will be uninterrupted, secure, or error-free. Your use of the Service is at your own risk.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">6. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, Velocity Alpha and its affiliates shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from your use of or inability to use the Service, even if we have been advised of the possibility of such damages.
              </p>
              <p className="mt-4">
                Some jurisdictions do not allow the limitation of liability for certain damages, so some of the above limitations may not apply to you.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">7. Third-Party Links</h2>
              <p>
                Our Service may contain links to third-party websites. We do not monitor or control these websites and are not responsible for their content or privacy practices. Your use of third-party sites is subject to their own terms and conditions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">8. Governing Law</h2>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, without regard to its conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">9. Changes to Terms</h2>
              <p>
                We reserve the right to modify these Terms at any time. We will indicate the "Last Updated" date at the top of this page. Your continued use of the Service after changes are posted constitutes your acceptance of the new Terms.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-serif font-bold text-[var(--text-primary)] mb-4">10. Contact Information</h2>
              <p>
                Questions about the Terms of Service should be sent to:
              </p>
              <div className="mt-4 p-6 bg-[var(--bg-secondary)] rounded-lg">
                <p className="font-bold text-[var(--text-primary)]">Velocity Alpha</p>
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
