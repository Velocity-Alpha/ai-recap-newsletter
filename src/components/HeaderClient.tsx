'use client'

import Image from 'next/image'
import Link from 'next/link'

type HeaderClientProps = {
  showSubscribeButton: boolean
}

export default function HeaderClient({ showSubscribeButton }: HeaderClientProps) {
  return (
    <header className="w-full bg-[var(--bg-card)] border-b border-[var(--border-light)] sticky top-0 z-50">
      <nav className="container mx-auto flex items-center justify-between px-6 py-4 max-w-[var(--container)]">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Image
            src="/logo/logo.png"
            alt="AI Recap"
            width={134}
            height={34}
            priority
            className="h-6 w-auto"
          />
          <span className="font-sans text-2xl font-black tracking-tight text-black">RECAP</span>
        </Link>

        <div className="hidden md:flex items-center gap-10">
          <Link
            href="/"
            className="font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
            style={{ fontSize: 'var(--text-small)' }}
            onClick={(e) => {
              if (window.location.pathname === '/') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            Home
          </Link>
          <Link
            href="/archive"
            className="font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
            style={{ fontSize: 'var(--text-small)' }}
          >
            Archive
          </Link>
          {showSubscribeButton ? (
            <button
              onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
              className="cursor-pointer px-6 py-3 bg-[var(--text-primary)] text-white font-semibold rounded transition-all duration-200 hover:bg-[var(--watercolor-ink)]"
              style={{ fontSize: 'var(--text-small)' }}
            >
              Subscribe
            </button>
          ) : null}
        </div>

        {showSubscribeButton ? (
          <button
            onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
            className="md:hidden cursor-pointer px-4 py-2 bg-[var(--text-primary)] text-white font-semibold rounded transition-all duration-200 hover:bg-[var(--watercolor-ink)]"
            style={{ fontSize: 'var(--text-small)' }}
          >
            Subscribe
          </button>
        ) : null}
      </nav>
    </header>
  )
}
