import Header from '@/src/components/Header'
import Hero from '@/src/components/Hero'
import Features from '@/src/components/Features'
import RecentNewslettersPreview from '@/src/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { getSafeNewsletterListPage, getSafeCachedTickerFeed } from '@/src/features/newsletter/server'
import React from 'react'

// A public page: always the signed-out markup. The browser hides the Subscribe buttons and form in the
// subscriber view.
export default async function HomePage() {
  const [newsletterPage, tickerFeed] = await Promise.all([
    getSafeNewsletterListPage(1, 6),
    getSafeCachedTickerFeed(),
  ])

  return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header />
            <Hero
              initialTickerStories={tickerFeed.data}
              initialTickerStats={tickerFeed.stats}
            />
            <Features />
            <RecentNewslettersPreview newsletters={newsletterPage.data} />
            <SubscribeNewsletter />
            <Footer />
        </div>
    )
}
