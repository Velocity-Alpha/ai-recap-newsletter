import Header from '@/src/components/Header'
import Hero from '@/src/components/Hero'
import Features from '@/src/components/Features'
import RecentNewslettersPreview from '@/src/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { getSafeCachedNewsletterListPage, getSafeCachedTickerFeed } from '@/src/features/newsletter/server'
import { findSubscriberByIdSafely, getSubscriberSessionFromCookies } from '@/src/features/subscriber/server'
import React from 'react'

export default async function HomePage() {
  const [session, newsletterPage, tickerFeed] = await Promise.all([
    getSubscriberSessionFromCookies(),
    getSafeCachedNewsletterListPage(1, 6),
    getSafeCachedTickerFeed(),
  ])
  const subscriber = session ? await findSubscriberByIdSafely(session.subscriberId) : null
  const showSubscribe = Boolean(
    !subscriber ||
    subscriber.status !== 'active' ||
    subscriber.email !== session?.email
  )

  return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header />
            <Hero
              initialTickerStories={tickerFeed.data}
              initialTickerStats={tickerFeed.stats}
            />
            <Features />
            <RecentNewslettersPreview newsletters={newsletterPage.data} />
            {showSubscribe ? <SubscribeNewsletter /> : null}
            <Footer />
        </div>
    )
}
