'use client'
import ScrollAnimation from './ScrollAnimation';

const features = [
  {
    icon: '📰',
    title: 'Daily Briefings',
    description: 'Get curated AI news and insights delivered to your inbox every morning. Stay informed without the noise.',
    bgColor: 'bg-gradient-to-br from-blue-50 to-cyan-50',
  },
  {
    icon: '🔬',
    title: 'Research Deep Dives',
    description: 'In-depth analysis of the latest AI research papers and breakthrough technologies from leading institutions.',
    bgColor: 'bg-gradient-to-br from-purple-50 to-pink-50',
  },
  {
    icon: '🛠️',
    title: 'Practical Tools',
    description: 'Discover trending AI tools and learn how to implement them in your projects with step-by-step guides.',
    bgColor: 'bg-gradient-to-br from-cyan-50 to-blue-50',
  },
  {
    icon: '⚡',
    title: 'Quick Insights',
    description: 'Fast-paced updates on industry news, funding rounds, and major announcements in the AI space.',
    bgColor: 'bg-gradient-to-br from-indigo-50 to-purple-50',
  },
  {
    icon: '🎯',
    title: 'Curated Content',
    description: 'Our team of experts handpicks the most important stories so you only see what matters.',
    bgColor: 'bg-gradient-to-br from-teal-50 to-cyan-50',
  },
  {
    icon: '🚀',
    title: 'Stay Ahead',
    description: 'Be the first to know about emerging trends and opportunities in the rapidly evolving AI landscape.',
    bgColor: 'bg-gradient-to-br from-sky-50 to-blue-50',
  },
];

export default function Features() {
  return (
    <section className="py-24 bg-white relative overflow-hidden">
      {/* Unique animated background for Features - Diagonal lines pattern */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Diagonal animated lines */}
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#66ccff]/20 to-transparent transform rotate-12 origin-left animate-diagonal"></div>
          <div className="absolute top-20 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#66ccff]/15 to-transparent transform rotate-12 origin-left animate-diagonal animation-delay-2000"></div>
          <div className="absolute top-40 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#66ccff]/20 to-transparent transform rotate-12 origin-left animate-diagonal animation-delay-4000"></div>
          <div className="absolute top-60 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#66ccff]/15 to-transparent transform rotate-12 origin-left animate-diagonal animation-delay-1000"></div>
        </div>
        
        {/* Geometric shapes */}
        <div className="absolute top-10 right-10 w-20 h-20 border-2 border-[#66ccff]/20 rotate-45 animate-rotate-slow"></div>
        <div className="absolute bottom-20 left-20 w-16 h-16 border-2 border-[#66ccff]/20 rounded-full animate-pulse-slow"></div>
        <div className="absolute top-1/2 right-1/4 w-12 h-12 border-2 border-[#66ccff]/20 rotate-45 animate-rotate-slow" style={{ animationDirection: 'reverse', animationDuration: '15s' }}></div>
        
        {/* Floating dots */}
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-[#66ccff]/40 rounded-full animate-float"></div>
        <div className="absolute top-3/4 right-1/3 w-2.5 h-2.5 bg-[#66ccff]/40 rounded-full animate-float animation-delay-2000"></div>
        <div className="absolute bottom-1/4 left-2/3 w-2 h-2 bg-[#66ccff]/40 rounded-full animate-float animation-delay-4000"></div>
      </div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <ScrollAnimation animationType="fade-in">
          <div className="text-center mb-20">
            <div className="inline-block px-4 py-1.5 rounded-full bg-[#66ccff]/10 text-[#66ccff] text-sm font-semibold mb-4">
              Why Choose Us
            </div>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-black mb-6">
              Why Choose AI Recap?
            </h2>
            <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              Everything you need to stay informed and ahead in the world of artificial intelligence
            </p>
          </div>
        </ScrollAnimation>

        {/* Features Grid with staggered animations */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <ScrollAnimation 
              key={index}
              animationType="scale" 
              delay={index * 100}
              className={`stagger-${index + 1}`}
            >
              <div
                className={`group relative p-8 lg:p-10 rounded-2xl ${feature.bgColor} border border-gray-200/50 shadow-md hover:shadow-xl transition-all duration-500 transform hover:-translate-y-2 hover:scale-[1.01] overflow-hidden`}
              >
                {/* Hover background effect */}
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/20 transition-all duration-500"></div>
                
                {/* Icon with enhanced animation */}
                <div className="relative z-10 text-6xl mb-6 transform group-hover:scale-110 transition-all duration-500">
                  {feature.icon}
                </div>

                {/* Content */}
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold text-black mb-4 group-hover:text-[#66ccff] transition-colors duration-300">
                    {feature.title}
                  </h3>
                  <p className="text-gray-700 leading-relaxed text-base">
                    {feature.description}
                  </p>
                </div>
                
                {/* Hover border effect */}
                <div className="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-[#66ccff]/30 transition-all duration-500"></div>
              </div>
            </ScrollAnimation>
          ))}
        </div>
      </div>
    </section>
  );
}
