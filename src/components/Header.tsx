'use client'

import Link from 'next/link'

export default function Header() {
  return (
    <header className="w-full bg-white border-b border-gray-200 shadow-sm">
      <nav className="mx-auto flex items-center justify-center md:justify-between px-6 py-6 max-w-7xl">
        {/* Logo - AI Recap with fancy design */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity group">
          <div className="relative">
            {/* Background gradient circle */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#66ccff] to-[#3B82F6] rounded-full blur-sm opacity-60 group-hover:opacity-80 transition-opacity"></div>
            {/* AI Icon/Text */}
            <div className="relative bg-gradient-to-br from-[#66ccff] to-[#3B82F6] px-4 py-2 rounded-lg shadow-md">
              <span className="text-white text-xl font-bold tracking-tight">AI</span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold bg-gradient-to-r from-[#66ccff] to-[#3B82F6] bg-clip-text text-transparent leading-tight">
              Recap
            </span>
            <span className="text-xs text-gray-500 font-medium -mt-1">Newsletter</span>
          </div>
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

