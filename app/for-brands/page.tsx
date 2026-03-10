import type { Metadata } from 'next'

import Footer from '@/src/components/Footer'
import Header from '@/src/components/Header'
import HeroSection from './sections/HeroSection'
import PainSection from './sections/PainSection'
import SolutionSection from './sections/SolutionSection'
import WhyEmailSection from './sections/WhyEmailSection'
import StepsSection from './sections/StepsSection'
import CtaSection from './sections/CtaSection'

export const metadata: Metadata = {
  title: 'For Brands | AI Recap',
  description:
    'Your prospects are forgetting about you between deals. We build and run a branded newsletter that keeps you top of mind, books more calls, and grows search traffic. Five-minute review, not a five-hour scramble.',
}

export default function ForBrandsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      <Header />

      <main>
        <HeroSection />
        <PainSection />
        <SolutionSection />
        <WhyEmailSection />
        <StepsSection />
        <CtaSection />
      </main>

      <Footer />
    </div>
  )
}
