import Header from '@/src/components/Header'
import Hero from '@/src/components/Hero'
import Features from '@/src/components/Features'
import RecentNewslettersPreview from '@/src/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { getSafeCachedNewsletterListPage, getSafeCachedTickerFeed } from '@/src/features/newsletter/server'
import { hasActiveSubscriberSession } from '@/src/features/subscriber/server'
import React from 'react'

export default async function HomePage() {
  const [isSignedIn, newsletterPage, tickerFeed] = await Promise.all([
    hasActiveSubscriberSession(),
    getSafeCachedNewsletterListPage(1, 6),
    getSafeCachedTickerFeed(),
  ])
  const showSubscribe = !isSignedIn

  return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header showSubscribeButton={showSubscribe} />
            <Hero
              showSubscribeButton={showSubscribe}
              initialTickerStories={tickerFeed.data}
              initialTickerStats={tickerFeed.stats}
            />
            <Features />
            <RecentNewslettersPreview newsletters={newsletterPage.data} showSubscribeButton={showSubscribe} />
            {showSubscribe ? <SubscribeNewsletter /> : null}
            <Footer showSubscribeLink={showSubscribe} />
        </div>
    )
}
