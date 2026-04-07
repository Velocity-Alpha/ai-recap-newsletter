import Header from '@/components/Header'
import Hero from '@/components/Hero'
import Features from '@/components/Features'
import RecentNewslettersPreview from '@/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/components/SubscribeNewsletter'
import Footer from '@/components/Footer'
import { getSafeCachedNewsletterListPage, getSafeCachedTickerFeed } from '@/features/newsletter/server'
import { hasActiveSubscriberSession } from '@/features/subscriber/session'
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
