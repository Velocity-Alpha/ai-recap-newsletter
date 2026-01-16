'use client'
import Link from 'next/link';
import ScrollAnimation from './ScrollAnimation';

export default function Hero() {
  return (
    <section className="relative min-h-[95vh] flex items-center justify-center overflow-hidden bg-white">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Animated grid pattern - more visible */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#66ccff15_1px,transparent_1px),linear-gradient(to_bottom,#66ccff15_1px,transparent_1px)] bg-[size:60px_60px] animate-grid"></div>
        
        {/* Floating blue orbs - more visible */}
        <div className="absolute top-20 left-10 w-96 h-96 bg-primary/15 rounded-full filter blur-3xl animate-float"></div>
        <div className="absolute top-40 right-10 w-96 h-96 bg-primary/15 rounded-full filter blur-3xl animate-float animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-1/2 w-96 h-96 bg-primary/15 rounded-full filter blur-3xl animate-float animation-delay-4000"></div>
        
        {/* Animated lines - more visible */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-line"></div>
        <div className="absolute top-1/3 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/35 to-transparent animate-line animation-delay-2000"></div>
        <div className="absolute top-2/3 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-line animation-delay-4000"></div>
        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/35 to-transparent animate-line animation-delay-1000"></div>
        
        {/* Rotating geometric shapes - more visible */}
        <div className="absolute top-1/4 right-1/4 w-32 h-32 border-2 border-primary/25 rounded-full animate-rotate-slow"></div>
        <div className="absolute bottom-1/4 left-1/4 w-24 h-24 border-2 border-primary/25 rotate-45 animate-rotate-slow" style={{ animationDirection: 'reverse', animationDuration: '25s' }}></div>
        
        {/* Pulsing dots - more visible */}
        <div className="absolute top-1/3 left-1/3 w-4 h-4 bg-primary/50 rounded-full animate-pulse-slow shadow-lg shadow-primary/30"></div>
        <div className="absolute top-2/3 right-1/3 w-3 h-3 bg-primary/50 rounded-full animate-pulse-slow animation-delay-2000 shadow-lg shadow-primary/30"></div>
        <div className="absolute bottom-1/3 left-2/3 w-3.5 h-3.5 bg-primary/50 rounded-full animate-pulse-slow animation-delay-4000 shadow-lg shadow-primary/30"></div>
        
        {/* Vertical animated lines - more visible */}
        <div className="absolute top-0 left-1/4 w-[2px] h-full bg-gradient-to-b from-transparent via-primary/25 to-transparent animate-line" style={{ animationDuration: '12s' }}></div>
        <div className="absolute top-0 right-1/4 w-[2px] h-full bg-gradient-to-b from-transparent via-primary/25 to-transparent animate-line animation-delay-2000" style={{ animationDuration: '12s' }}></div>
        
        {/* Additional animated circles for depth */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-primary/20 rounded-full animate-pulse-slow"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 border border-primary/15 rounded-full animate-pulse-slow animation-delay-2000"></div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        {/* Badge with animation */}
        <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F5F5F5] border border-gray-200 mb-8 shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105">
          <span className="w-2.5 h-2.5 bg-[#66ccff] rounded-full animate-pulse"></span>
          <span className="text-sm font-semibold text-black">Daily AI Intelligence from AI Recap</span>
        </div>

        {/* Main Headline */}
        <h1 className="wdxl-lubrifont-sc-regular text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-tight tracking-tight">
          <span className="text-black block mb-2">
            Stay Ahead with
          </span>
          <span className="text-[#66ccff] block">AI Recap</span>
        </h1>

        {/* Subheadline */}
        <p className="molengo-regular text-xl md:text-2xl lg:text-3xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed font-light">
          Get the latest AI news, breakthrough research, and practical insights delivered to your inbox every day. 
          <span className="block mt-2 text-lg md:text-xl">Join thousands of professionals staying ahead of the curve.</span>
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
          <button
            onClick={() => {
              document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="group px-10 py-5 bg-[#66ccff] text-white rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 hover:bg-[#66ccff]/90"
          >
            Subscribe Free
          </button>
          <Link
            href="/newsletters"
            className="px-10 py-5 bg-white text-[#66ccff] rounded-xl font-semibold text-lg border-2 border-[#66ccff] shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-300 hover:bg-[#66ccff] hover:text-white inline-block text-center"
          >
            Browse Newsletters
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 md:gap-12 max-w-3xl mx-auto">
          <div className="text-center group">
            <div className="text-4xl md:text-5xl font-bold text-[#66ccff] mb-2 group-hover:scale-110 transition-transform duration-300">10K+</div>
            <div className="text-sm md:text-base text-gray-600 font-medium">Subscribers</div>
          </div>
          <div className="text-center group">
            <div className="text-4xl md:text-5xl font-bold text-[#66ccff] mb-2 group-hover:scale-110 transition-transform duration-300">Daily</div>
            <div className="text-sm md:text-base text-gray-600 font-medium">Updates</div>
          </div>
          <div className="text-center group">
            <div className="text-4xl md:text-5xl font-bold text-[#66ccff] mb-2 group-hover:scale-110 transition-transform duration-300">100%</div>
            <div className="text-sm md:text-base text-gray-600 font-medium">Free</div>
          </div>
        </div>
      </div>
    </section>
  );
}

