import Header from '@/src/components/Header'
import Hero from '@/src/components/Hero'
import Features from '@/src/components/Features'
import RecentNewslettersPreview from '@/src/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import React from 'react'

export default function HomePage() {
  return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header />
            <Hero />
            <Features />
            <RecentNewslettersPreview />
            <SubscribeNewsletter />
            <Footer />
        </div>
    )
}
