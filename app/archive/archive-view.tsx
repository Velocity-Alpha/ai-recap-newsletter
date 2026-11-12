import Header from '@/src/components/Header'
import RecentNewsletters from '@/src/components/RecentNewsletters'
import SubscribeNewsletter from '@/src/components/SubscribeNewsletter'
import Footer from '@/src/components/Footer'
import { ARCHIVE_PAGE_SIZE } from '@/src/features/newsletter/archive-paths'
import type { NewsletterListPage } from '@/src/features/newsletter/repository'
import { getCachedNewsletterListPage } from '@/src/features/newsletter/server'
import React from 'react'

/**
 * One archive page. A page past the end gives the last page. Throws on a database error, so a cached archive
 * page keeps its last good copy instead of being replaced by an empty one.
 */
export async function loadArchivePage(page: number): Promise<NewsletterListPage> {
    const newsletterPage = await getCachedNewsletterListPage(page, ARCHIVE_PAGE_SIZE)
    const { totalPages } = newsletterPage.pagination

    if (totalPages > 0 && page > totalPages) {
        return getCachedNewsletterListPage(totalPages, ARCHIVE_PAGE_SIZE)
    }

    return newsletterPage
}

// A public page: always the signed-out markup. The browser hides the subscribe form in the subscriber view.
export default function ArchiveView({ newsletterPage }: { newsletterPage: NewsletterListPage }) {
    return (
        <div className='flex flex-col min-h-screen bg-[var(--bg-main)]'>
            <Header />
            <div className="pt-8 relative overflow-hidden">
                <RecentNewsletters
                    newsletters={newsletterPage.data}
                    currentPage={newsletterPage.pagination.currentPage}
                    totalPages={newsletterPage.pagination.totalPages}
                />
            </div>
            <SubscribeNewsletter />
            <Footer />
        </div>
    )
}
