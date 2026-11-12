import Header from '@/src/components/Header'
import Hero from '@/src/components/Hero'
import Features from '@/src/components/Features'
import RecentNewslettersPreview from '@/src/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { getCachedNewsletterListPage, getCachedTickerFeed } from '@/src/features/newsletter/server'
import React from 'react'

// The CDN caches the home page. It rebuilds in the background every 5 minutes, the ticker data's lifetime, and at
// once when an issue publishes (the published-issues tag on its data reads).
export const revalidate = 300

/** Newest issues in the home page's preview. */
const HOME_PREVIEW_ISSUE_COUNT = 6

// A public page: always the signed-out markup. The browser hides the Subscribe buttons and form in the
// subscriber view. The data reads throw on a failed read, so a failed rebuild keeps the last good page instead
// of caching an empty one.
export default async function HomePage() {
  const [newsletterPage, tickerFeed] = await Promise.all([
    getCachedNewsletterListPage(1, HOME_PREVIEW_ISSUE_COUNT),
    getCachedTickerFeed(),
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
