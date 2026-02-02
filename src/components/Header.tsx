'use client'

import Image from 'next/image'
import Link from 'next/link'

export default function Header() {
  return (
    <header className="w-full bg-[var(--bg-card)] border-b border-[var(--border-light)] sticky top-0 z-50">
      <nav className="container mx-auto flex items-center justify-center md:justify-between px-6 py-4 max-w-[var(--container)]">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <Image
            src="/logo/logo.png"
            alt="AI Recap"
            width={140}
            height={40}
            priority
            className="h-10 w-auto"
          />
          <span className="font-sans text-2xl font-black tracking-tight text-black">AI RECAP</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-10">
          <a 
            href="/" 
            className="font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'var(--text-small)' }}
            onClick={(e) => {
              if (window.location.pathname === '/') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            Home
          </a>
          <Link 
            href="/newsletters" 
            className="font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'var(--text-small)' }}
          >
            Newsletters
          </Link>
          <button 
            onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-6 py-3 bg-[var(--text-primary)] text-white font-semibold rounded transition-all duration-200 hover:bg-[var(--watercolor-ink)]" style={{ fontSize: 'var(--text-small)' }}
          >
            Subscribe
          </button>
        </div>
      </nav>
    </header>
  );
}

