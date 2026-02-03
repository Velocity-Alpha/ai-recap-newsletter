import Header from '@/src/components/Header'
import RecentNewsletters from '@/src/components/RecentNewsletters'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import React from 'react'

export default function ArchivePage() {
    return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header />
            <div className="pt-8 relative overflow-hidden">
                <RecentNewsletters />
            </div>
            <SubscribeNewsletter />
            <Footer />
        </div>
    )
}
