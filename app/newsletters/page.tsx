'use client'

import Header from '@/src/components/Header'
import RecentNewsletters from '@/src/components/RecentNewsletters'
import Footer from '@/src/components/Footer'
import React from 'react'

export default function NewslettersPage() {
    return (
        <div className='flex flex-col min-h-screen bg-background'>
            <Header />
            <div className="pt-8">
                <RecentNewsletters />
            </div>
            <Footer />
        </div>
    )
}

