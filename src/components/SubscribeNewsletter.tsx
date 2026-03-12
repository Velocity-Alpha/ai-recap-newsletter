'use client'
import { useEffect } from "react";

export default function SubscribeNewsletter() {

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://links.airecap.news/js/form_embed.js";
    script.async = true;

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return (
    <section id="subscribe" className="py-24 bg-[var(--watercolor-ink)] relative overflow-hidden">
      {/* Watercolor background effects */}
      <div className="absolute -top-1/2 -right-1/5 w-[600px] h-[600px] rounded-full opacity-10"
           style={{ background: 'radial-gradient(circle, var(--watercolor-blue) 0%, transparent 60%)' }}></div>
      <div className="absolute -bottom-1/3 -left-1/10 w-[400px] h-[400px] rounded-full opacity-[0.08]"
           style={{ background: 'radial-gradient(circle, var(--watercolor-rust) 0%, transparent 60%)' }}></div>
      
      <div className="container mx-auto px-6 max-w-[580px] text-center relative z-10">
        {/* Heading */}
        <h2 className="font-serif font-normal leading-[1.2] text-white mb-4" style={{ fontSize: 'var(--text-section)' }}>
          Join the AI Recap Newsletter
        </h2>

        {/* Description */}
        <p className="text-white/65 mb-10 max-w-[480px] mx-auto text-center" style={{ fontSize: 'var(--text-body)' }}>
          Get the latest AI news, research insights, and practical
          implementation guides delivered to your inbox daily.
        </p>

        {/* iframe form */}
        <div className="w-full h-auto rounded overflow-hidden">
          <iframe
            src="https://links.airecap.news/widget/form/cRFEXYhixTIqE6267qMj"
            className="w-full h-full border-none rounded-none"
            id="inline-cRFEXYhixTIqE6267qMj"
            data-layout='{"id":"INLINE"}'
            data-trigger-type="alwaysShow"
            data-trigger-value=""
            data-activation-type="alwaysActivated"
            data-activation-value=""
            data-deactivation-type="neverDeactivate"
            data-deactivation-value=""
            data-form-name="Newsletter Signup Form - Dark"
            data-height="254"
            data-layout-iframe-id="inline-cRFEXYhixTIqE6267qMj"
            data-form-id="cRFEXYhixTIqE6267qMj"
            title="Newsletter Signup Form - Dark"
          />
        </div>

        {/* Consent Note */}
        <p className="mt-6 text-white/40 text-[14px] leading-relaxed">
          By subscribing, you agree to our <a href="/terms" className="underline hover:text-white/60">Terms of Service</a> and <a href="/privacy" className="underline hover:text-white/60">Privacy Policy</a>. 
        </p>

      </div>
    </section>
  );
}
