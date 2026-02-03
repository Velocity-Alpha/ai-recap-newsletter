import Image from 'next/image'
import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-[var(--bg-card)] border-t border-[var(--border-light)] py-16">
      <div className="container mx-auto px-6 max-w-[var(--container)]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity mb-4">
              <Image
                src="/logo/logo-2.png"
                alt="AI Recap"
                width={120}
                height={34}
                className="h-8 w-auto"
              />
              <span className="font-sans text-2xl font-black tracking-tight text-black">RECAP</span>
            </Link>
            <p className="leading-[1.6] text-[var(--text-secondary)] max-w-[320px]" style={{ fontSize: 'var(--text-body)' }}>
              AI Recap is your daily source for AI news, research insights, and practical implementation guides. 
              Stay ahead of the curve in the world of artificial intelligence.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold text-[var(--text-primary)] mb-6 uppercase tracking-wider" style={{ fontSize: 'var(--text-caption)' }}>Quick Links</h4>
            <ul className="space-y-2.5">
              <li>
                <a href="/" className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'var(--text-small)' }}>
                  Home
                </a>
              </li>
              <li>
                <a href="/archive" className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'var(--text-small)' }}>
                  Archive
                </a>
              </li>
              <li>
                <a href="#subscribe" className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'var(--text-small)' }}>
                  Subscribe
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col md:flex-row justify-between items-center pt-10 mt-10 border-t border-[var(--border-light)]">
          <p className="text-[var(--text-muted)]" style={{ fontSize: 'var(--text-caption)' }}>
            © 2026 AI Recap by Velocity Alpha. All rights reserved.
          </p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <a href="/privacy" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors" style={{ fontSize: 'var(--text-caption)' }}>
              Privacy Policy
            </a>
            <a href="/terms" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors" style={{ fontSize: 'var(--text-caption)' }}>
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
