export default function Footer() {
  return (
    <footer className="bg-secondary border-t border-border mt-20 relative overflow-hidden">
      {/* Unique animated background for Footer - Subtle dots and lines */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Subtle dot pattern */}
        <div className="absolute inset-0">
          {[...Array(30)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-primary/20 rounded-full animate-pulse-slow"
              style={{
                left: `${(i * 7) % 100}%`,
                top: `${(i * 11) % 100}%`,
                animationDelay: `${i * 0.3}s`,
              }}
            />
          ))}
        </div>
        
        {/* Horizontal lines */}
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent"></div>
        <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent"></div>
      </div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#66ccff] to-[#3B82F6] rounded-full blur-sm opacity-60"></div>
                <div className="relative bg-gradient-to-br from-[#66ccff] to-[#3B82F6] px-3 py-1.5 rounded-lg shadow-md">
                  <span className="text-white text-lg font-bold tracking-tight">AI</span>
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold bg-gradient-to-r from-[#66ccff] to-[#3B82F6] bg-clip-text text-transparent leading-tight">
                  Recap
                </span>
                <span className="text-xs text-gray-500 font-medium -mt-1">Newsletter</span>
              </div>
            </div>
            <p className="text-gray-600 mb-4 max-w-md">
              Your daily source for AI news, research insights, and practical implementation guides. 
              Stay ahead of the curve in the world of artificial intelligence.
            </p>
            <div className="flex gap-4">
              <a href="#" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                Twitter
              </a>
              <a href="#" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                LinkedIn
              </a>
              <a href="#" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                GitHub
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold text-black mb-4">Quick Links</h4>
            <ul className="space-y-2">
              <li>
                <a href="/" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                  Home
                </a>
              </li>
              <li>
                <a href="#newsletters" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                  Newsletters
                </a>
              </li>
              <li>
                <a href="#subscribe" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                  Subscribe
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold text-black mb-4">Resources</h4>
            <ul className="space-y-2">
              <li>
                <a href="#" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                  Archive
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                  About
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-600 hover:text-[#66ccff] transition-colors">
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm text-gray-600">
            © {new Date().getFullYear()} AI Recap. All rights reserved.
          </p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <a href="#" className="text-sm text-gray-600 hover:text-[#66ccff] transition-colors">
              Privacy Policy
            </a>
            <a href="#" className="text-sm text-gray-600 hover:text-[#66ccff] transition-colors">
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

