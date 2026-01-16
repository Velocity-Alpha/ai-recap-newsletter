'use client'
import { useEffect } from "react";

export default function SubscribeNewsletter() {

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://links.velocityalpha.com/js/form_embed.js";
    script.async = true;

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return (
    <section id="subscribe" className="flex items-center justify-center px-4 py-20 bg-white relative overflow-hidden">
      {/* Unique animated background for Subscribe - Radial circles */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Concentric circles pulsing from center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border border-[#66ccff]/15 rounded-full animate-radial"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 border border-[#66ccff]/20 rounded-full animate-radial animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-[#66ccff]/25 rounded-full animate-radial animation-delay-4000"></div>
        
        {/* Corner decorations */}
        <div className="absolute top-10 left-10 w-16 h-16 border-2 border-[#66ccff]/20 rounded-full animate-pulse-slow"></div>
        <div className="absolute top-10 right-10 w-12 h-12 border-2 border-[#66ccff]/20 rotate-45 animate-rotate-slow"></div>
        <div className="absolute bottom-10 left-10 w-12 h-12 border-2 border-[#66ccff]/20 rotate-45 animate-rotate-slow animation-delay-2000"></div>
        <div className="absolute bottom-10 right-10 w-16 h-16 border-2 border-[#66ccff]/20 rounded-full animate-pulse-slow animation-delay-4000"></div>
      </div>
      
      <div className="relative z-10 w-full max-w-2xl text-center">
        {/* Heading */}
        <h1 className="syne-mono-regular text-4xl md:text-5xl font-bold mb-6 text-black">
          Join our AI newsletter
        </h1>

        {/* Description */}
        <p className="molengo-regular text-gray-600 text-lg mb-10 leading-relaxed">
          Get the latest AI news, research insights, and practical
          implementation guides delivered to your inbox daily.
        </p>

        {/* iframe form */}
        <div className="w-full h-auto rounded-lg overflow-hidden bg-secondary shadow-lg p-4">
          <iframe
            src="https://links.velocityalpha.com/widget/form/U3Z77WiIoyPTx24EFNj1"
            className="w-full h-full border-none rounded-lg"
            id="inline-3v7ZRjuohbjIgMs6zYMt"
            data-layout='{"id":"INLINE"}'
            data-trigger-type="alwaysShow"
            data-activation-type="alwaysActivated"
            data-deactivation-type="neverDeactivate"
            data-form-name="Newsletter Signup Form"
            data-height="491"
            data-form-id="3v7ZRjuohbjIgMs6zYMt"
            title="Newsletter Signup Form"
          />
        </div>

      </div>
    </section>
  );
}
