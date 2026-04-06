import Header from '@/src/components/Header'
import RecentNewsletters from '@/src/components/RecentNewsletters'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { getSafeCachedNewsletterListPage } from '@/src/features/newsletter/server'
import { hasActiveSubscriberSession } from '@/src/features/subscriber/server'
import React from 'react'

interface ArchivePageProps {
    searchParams: Promise<{ page?: string | string[] }>
}

function parsePageNumber(value: string | string[] | undefined) {
    const rawValue = Array.isArray(value) ? value[0] : value
    const parsedValue = Number.parseInt(rawValue ?? "", 10)

    if (!Number.isFinite(parsedValue) || parsedValue < 1) {
        return 1
    }

    return parsedValue
}

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
    const [{ page }, isSignedIn] = await Promise.all([
        searchParams,
        hasActiveSubscriberSession(),
    ])
    const currentPage = parsePageNumber(page)
    let newsletterPage = await getSafeCachedNewsletterListPage(currentPage, 6)

    if (newsletterPage.pagination.totalPages > 0 && currentPage > newsletterPage.pagination.totalPages) {
        newsletterPage = await getSafeCachedNewsletterListPage(newsletterPage.pagination.totalPages, 6)
    }

    const showSubscribe = !isSignedIn

    return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header showSubscribeButton={showSubscribe} />
            <div className="pt-8 relative overflow-hidden">
                <RecentNewsletters
                    newsletters={newsletterPage.data}
                    currentPage={newsletterPage.pagination.currentPage}
                    totalPages={newsletterPage.pagination.totalPages}
                    showSubscribeButton={showSubscribe}
                />
            </div>
            {showSubscribe ? <SubscribeNewsletter /> : null}
            <Footer showSubscribeLink={showSubscribe} />
        </div>
    )
}
