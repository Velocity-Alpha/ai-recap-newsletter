import Header from '@/src/components/Header'
import Hero from '@/src/components/Hero'
import Features from '@/src/components/Features'
import RecentNewslettersPreview from '@/src/components/RecentNewslettersPreview'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { findSubscriberById, getSubscriberSessionFromCookies } from '@/src/features/subscriber/server'
import React from 'react'

export default async function HomePage() {
  const session = await getSubscriberSessionFromCookies()
  const subscriber = session ? await findSubscriberById(session.subscriberId) : null
  const showSubscribe = Boolean(
    !subscriber ||
    subscriber.status !== 'active' ||
    subscriber.email !== session?.email
  )

  return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header />
            <Hero />
            <Features />
            <RecentNewslettersPreview />
            {showSubscribe ? <SubscribeNewsletter /> : null}
            <Footer />
        </div>
    )
}
