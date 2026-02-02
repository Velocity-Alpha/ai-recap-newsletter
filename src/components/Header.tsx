'use client'

import Image from 'next/image'
import Link from 'next/link'

export default function Header() {
  return (
    <header className="w-full bg-white border-b border-gray-200 shadow-sm">
      <nav className="mx-auto flex items-center justify-center md:justify-between px-6 py-6 max-w-7xl">
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
          <span className="sr-only">AI Recap</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center space-x-6">
          <a 
            href="/" 
            className="text-gray-600 hover:text-black transition-colors"
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
            className="text-gray-600 hover:text-black transition-colors"
          >
            Newsletters
          </Link>
          <a 
            href="#subscribe" 
            className="text-gray-600 hover:text-black transition-colors"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Subscribe
          </a>
        </div>
      </nav>
    </header>
  );
}

