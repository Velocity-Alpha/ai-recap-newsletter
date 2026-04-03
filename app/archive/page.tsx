import Header from '@/src/components/Header'
import RecentNewsletters from '@/src/components/RecentNewsletters'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { findSubscriberById, getSubscriberSessionFromCookies } from '@/src/features/subscriber/server'
import React from 'react'

export default async function ArchivePage() {
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
            <div className="pt-8 relative overflow-hidden">
                <RecentNewsletters />
            </div>
            {showSubscribe ? <SubscribeNewsletter /> : null}
            <Footer />
        </div>
    )
}
